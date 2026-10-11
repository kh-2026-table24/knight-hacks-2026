"""Qwen-Image 20B image generation on a Modal cloud GPU.

Runs open-weight models from Hugging Face (Apache 2.0) behind one HTTPS endpoint for the game server:
Qwen/Qwen-Image draws from text, and Qwen/Qwen-Image-Edit-2511 redraws a reference image (later
animation frames), so frames keep their first frame's style. Both use 4-step Lightning LoRAs.

Setup, once:
    pip install modal && modal setup
    modal secret create huggingface-secret HF_TOKEN=hf_...
    modal run imagegen/qwen_modal.py::download     # ~120 GB into the volume, on a cheap CPU container
Try it (draws on the cloud GPU, saves the result locally):
    modal run imagegen/qwen_modal.py::main --prompt "a rusty lantern" --aspect-ratio 3:4
    modal run imagegen/qwen_modal.py::main --prompt "the same lantern, flame flickering" --reference /tmp/qwen-test.png
Draw a character and its animation frames the way the game does, with timings:
    modal run imagegen/qwen_modal.py::character_test
Deploy the endpoint (prints its URL):
    modal deploy imagegen/qwen_modal.py

Endpoint: POST JSON {"prompt": str, "aspect_ratio": "9:16", "reference": base64 image (optional),
"seed": int (optional)} -> image/png. It requires proxy auth: send the Modal-Key and Modal-Secret
headers from a proxy auth token (Modal dashboard -> Settings -> Proxy Auth Tokens).
"""

import base64
import binascii
import io
import math
import re
import time
from pathlib import Path

import modal

TEXT_MODEL = "Qwen/Qwen-Image"
EDIT_MODEL = "Qwen/Qwen-Image-Edit-2511"
# Distilled LoRAs that let each model draw in 4 steps instead of ~40, without classifier-free guidance.
TEXT_LORA = ("lightx2v/Qwen-Image-Lightning", "Qwen-Image-Lightning-4steps-V2.0-bf16.safetensors")
EDIT_LORA = ("lightx2v/Qwen-Image-Edit-2511-Lightning", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors")
STEPS = 4
CACHE_DIR = "/cache"
MINUTES = 60

# Every image is shrunk to 128px or less by the game server, but Qwen-Image is trained around 1328px and
# loses coherence well before 512px, so it draws near 1024x1024. Sides must be multiples of 16; very wide
# or tall shapes keep their short side at MIN_SIDE and their long side at MAX_SIDE.
TARGET_PIXELS = 1024 * 1024
MIN_SIDE = 256
MAX_SIDE = 2048

# One warm container is far faster than starting a second one (the models take a minute or more to
# load), so extra requests queue for it instead of starting more GPUs.
MAX_CONTAINERS = 1
MAX_PROMPT_CHARS = 4000
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
ASPECT_RATIO = re.compile(r"^([1-9]|1[0-9]|2[01]):([1-9]|1[0-9]|2[01])$")  # 1:1 up to 21:9, like Gemini's set

# Versions are left unpinned so the build gets a diffusers release with the Qwen-Image pipelines;
# pin them once a working set is confirmed so a later release can't break the demo.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch", "torchvision", "diffusers", "transformers", "accelerate", "peft", "pillow", "fastapi[standard]")
    .env({"HF_HUB_CACHE": CACHE_DIR})
)

app = modal.App("paradise-qwen", image=image)

# The weights download once into this volume instead of on every cold start. It keeps its name from the
# FLUX version because renaming it would mean downloading ~100 GB again.
hf_cache = modal.Volume.from_name("paradise-flux-hf-cache", create_if_missing=True)

with image.imports():
    import torch
    from diffusers import FlowMatchEulerDiscreteScheduler, QwenImageEditPlusPipeline, QwenImagePipeline, QwenImageTransformer2DModel
    from fastapi import HTTPException, Response
    from huggingface_hub import hf_hub_download, snapshot_download
    from PIL import Image


def size_for(aspect_ratio: str) -> tuple[int, int]:
    """Width and height for an aspect ratio like "9:16", near TARGET_PIXELS, both multiples of 16."""
    match = ASPECT_RATIO.match(aspect_ratio)
    if not match:
        raise ValueError(f'aspect_ratio must look like "9:16" (sides 1 to 21), got {aspect_ratio!r}')
    w, h = int(match[1]), int(match[2])
    scale = max((TARGET_PIXELS / (w * h)) ** 0.5, MIN_SIDE / min(w, h))
    scale = min(scale, MAX_SIDE / max(w, h))
    return round(w * scale / 16) * 16, round(h * scale / 16) * 16


def lightning_scheduler():
    # The Lightning LoRAs were distilled with a fixed shift of 3; these are the values from their model card.
    return FlowMatchEulerDiscreteScheduler.from_config({
        "base_image_seq_len": 256, "base_shift": math.log(3), "invert_sigmas": False, "max_image_seq_len": 8192,
        "max_shift": math.log(3), "num_train_timesteps": 1000, "shift": 1.0, "shift_terminal": None,
        "stochastic_sampling": False, "time_shift_type": "exponential", "use_beta_sigmas": False,
        "use_dynamic_shifting": True, "use_exponential_sigmas": False, "use_karras_sigmas": False,
    })


@app.function(volumes={CACHE_DIR: hf_cache}, secrets=[modal.Secret.from_name("huggingface-secret")], timeout=60 * MINUTES)
def download() -> None:
    """Fills the volume on a CPU-only container, so a GPU never sits idle billing during the download."""
    snapshot_download(TEXT_MODEL)
    # The edit model's text encoder and VAE are the text model's, already downloaded, so only its own parts.
    snapshot_download(EDIT_MODEL, allow_patterns=["transformer/*", "processor/*", "tokenizer/*", "scheduler/*", "*.json"])
    for repo, weights in (TEXT_LORA, EDIT_LORA):
        hf_hub_download(repo, weights)
    hf_cache.commit()


# H100 (80 GB): both 20B transformers in fp8 (~20 GB each) plus the shared bf16 text encoder (~17 GB) stay
# loaded together, so a game's text images and reference frames never wait for a model swap. Containers
# stay warm for a while after the last request so a game's burst of images doesn't pay a cold start each
# time. Requests are handled one at a time per container: the pipelines aren't safe to call from two threads.
@app.cls(
    gpu="H100",
    memory=80 * 1024,  # MiB; models pass through RAM on their way to the GPU
    volumes={CACHE_DIR: hf_cache},
    secrets=[modal.Secret.from_name("huggingface-secret")],
    scaledown_window=10 * MINUTES,
    timeout=30 * MINUTES,
    max_containers=MAX_CONTAINERS,
)
class Qwen:
    @modal.enter()
    def load(self) -> None:
        # Only from the volume (filled by download()): a missing file fails fast instead of downloading
        # gigabytes while the GPU bills.
        started = time.perf_counter()
        self.text = QwenImagePipeline.from_pretrained(
            TEXT_MODEL, scheduler=lightning_scheduler(), torch_dtype=torch.bfloat16, local_files_only=True
        )
        self.text.transformer.to("cuda")
        self.prepare(self.text, TEXT_LORA)
        print(f"text model ready after {time.perf_counter() - started:.1f} s")

        # Built around the text pipeline's text encoder and VAE, so they're loaded and kept on the GPU once.
        edit_transformer = QwenImageTransformer2DModel.from_pretrained(
            EDIT_MODEL, subfolder="transformer", torch_dtype=torch.bfloat16, local_files_only=True
        )
        self.edit = QwenImageEditPlusPipeline.from_pretrained(
            EDIT_MODEL,
            transformer=edit_transformer.to("cuda"),
            text_encoder=self.text.text_encoder,
            vae=self.text.vae,
            scheduler=lightning_scheduler(),
            torch_dtype=torch.bfloat16,
            local_files_only=True,
        )
        self.prepare(self.edit, EDIT_LORA)
        print(f"edit model ready after {time.perf_counter() - started:.1f} s")

        self.text.text_encoder.to("cuda")
        self.text.vae.to("cuda")
        print(f"loaded both models onto the GPU in {time.perf_counter() - started:.1f} s")

    @staticmethod
    def prepare(pipe, lora: tuple[str, str]) -> None:
        # Bake the Lightning LoRA into the bf16 weights, then store them as fp8 (half the memory) and widen
        # each layer back to bf16 as it runs. Fusing first keeps the LoRA's precision.
        pipe.load_lora_weights(lora[0], weight_name=lora[1], local_files_only=True)
        pipe.fuse_lora()
        pipe.unload_lora_weights()
        pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
        torch.cuda.empty_cache()

    def draw(self, prompt: str, aspect_ratio: str, reference: bytes | None, seed: int | None) -> bytes:
        width, height = size_for(aspect_ratio)
        started = time.perf_counter()
        options = {"prompt": prompt, "width": width, "height": height, "num_inference_steps": STEPS, "true_cfg_scale": 1.0}
        if seed is not None:
            options["generator"] = torch.Generator("cuda").manual_seed(seed)
        if reference is None:
            result = self.text(**options).images[0]
        else:
            result = self.edit(image=[Image.open(io.BytesIO(reference)).convert("RGB")], guidance_scale=1.0, **options).images[0]
        print(f"drew {width}x{height}{' from a reference' if reference else ''} in {time.perf_counter() - started:.2f} s on the GPU")
        # PNG, not JPEG: compression smears the green screen into the subject's edges.
        out = io.BytesIO()
        result.save(out, format="PNG")
        return out.getvalue()

    @modal.method()
    def generate(self, prompt: str, aspect_ratio: str = "1:1", reference: bytes | None = None, seed: int | None = None) -> bytes:
        return self.draw(prompt, aspect_ratio, reference, seed)

    @modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
    def web(self, body: dict):
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise HTTPException(400, f"prompt must be a non-empty string of at most {MAX_PROMPT_CHARS} characters")

        aspect_ratio = body.get("aspect_ratio", "1:1")
        if not isinstance(aspect_ratio, str) or not ASPECT_RATIO.match(aspect_ratio):
            raise HTTPException(400, 'aspect_ratio must look like "9:16" (sides 1 to 21)')

        seed = body.get("seed")
        if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool) or seed < 0):
            raise HTTPException(400, "seed must be a non-negative integer")

        reference = None
        if body.get("reference") is not None:
            try:
                reference = base64.b64decode(body["reference"], validate=True)
                Image.open(io.BytesIO(reference)).verify()
            except (binascii.Error, TypeError, ValueError, OSError):
                raise HTTPException(400, "reference must be a base64-encoded PNG or JPEG")
            if len(reference) > MAX_REFERENCE_BYTES:
                raise HTTPException(400, "reference image is too large")

        return Response(content=self.draw(prompt, aspect_ratio, reference, seed), media_type="image/png")


@app.local_entrypoint()
def character_test(subject: str = "scruffy brown terrier dog", aspect_ratio: str = "3:2", out_dir: str = "/tmp/qwen-dog") -> None:
    """Draws one character the way the game server does, and times each image.

    The first frame is drawn from text; every other frame is drawn from it as a reference, so they
    match. Run: modal run imagegen/qwen_modal.py::character_test
    """
    import json

    # Copied from server/assets.ts so the test measures the prompts the game really sends.
    style = "Dark, eerie 2D pixel art for a horror video game: muted desaturated colors, crisp hard-edged pixels, dark outlines, no anti-aliasing, no blur."
    key = "pure bright green (#00FF00)"

    def character_prompt(pose: str) -> str:
        return " ".join([
            style,
            f"A single full-body game character sprite of {subject}, {pose}.",
            "Facing right in a three-quarter view, centered, with the whole figure visible and filling most of the image.",
            f"Solid flat {key} background everywhere around the figure, and no bright green on the figure itself.",
            "No text, no border, no cast shadow, no ground, no scenery.",
        ])

    def frame_prompt(pose: str) -> str:
        return " ".join([
            style,
            "The attached image is the first frame of a sprite animation.",
            f"Draw another frame of the same animation: {subject}, {pose}.",
            "Keep the exact same subject, art style, pixel size, outlines, color palette, proportions and scale,",
            "and keep it in the same place in the image so the frames line up when played in sequence. Change only the pose or motion described.",
            f"Solid flat {key} background, the same as the attached image. No text, no border, no cast shadow, no scenery.",
        ])

    # A new direction isn't another frame of the same animation, so this prompt drops "keep it in the
    # same place, change only the pose" (which made the model keep the side view or draw two subjects)
    # and treats the reference purely as the character's design.
    def view_prompt(view: str) -> str:
        return " ".join([
            style,
            f"The attached image shows a game character: {subject}. Use it only as the reference for the character's design.",
            f"Draw a brand-new sprite of this same character seen {view}.",
            "Keep the same colors, markings, proportions, outlines and pixel-art style as the reference.",
            "Exactly one character in the image, drawn once, full body, centered and filling most of the image.",
            f"Solid flat {key} background everywhere around the character. No text, no border, no cast shadow, no ground, no scenery.",
        ])

    front = "from the front, facing straight toward the viewer: its face, both eyes and chest point at the camera"
    back = "from behind, facing straight away from the viewer: we see the back of its head and body, and its face is hidden"
    # (name, prompt, which earlier image to use as the reference). The engine mirrors right-facing frames to walk left.
    frames = [
        ("right-walk-1", frame_prompt("walking to the right, mid-stride with one leg stepping forward"), "right-idle"),
        ("right-walk-2", frame_prompt("walking to the right, mid-stride with the other leg stepping forward"), "right-idle"),
        ("front-idle", view_prompt(f"{front}, standing still"), "right-idle"),
        ("front-walk", frame_prompt("walking toward the viewer, mid-step with one foot lifted"), "front-idle"),
        ("back-idle", view_prompt(f"{back}, standing still"), "right-idle"),
        ("back-walk", frame_prompt("walking away from the viewer, mid-step with one foot lifted"), "back-idle"),
    ]

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    qwen = Qwen()
    timings = {}

    def save(name: str, prompt: str, reference: bytes | None) -> bytes:
        started = time.perf_counter()
        png = qwen.generate.remote(prompt, aspect_ratio, reference)
        timings[name] = round(time.perf_counter() - started, 2)
        (out / f"{len(timings) - 1}-{name}.png").write_bytes(png)
        print(f"{name:14} {timings[name]:6.2f} s{'  (includes cold start)' if len(timings) == 1 else ''}")
        return png

    total = time.perf_counter()
    drawn = {"right-idle": save("right-idle", character_prompt("standing still"), None)}
    for name, prompt, reference in frames:
        drawn[name] = save(name, prompt, drawn[reference])
    print(f"{len(timings)} images in {time.perf_counter() - total:.1f} s, saved to {out}")
    (out / "timings.json").write_text(json.dumps(timings, indent=2))


@app.local_entrypoint()
def main(prompt: str = "a rusty iron lantern", aspect_ratio: str = "1:1", reference: str = "", out: str = "/tmp/qwen-test.png") -> None:
    size_for(aspect_ratio)  # fail here, before a GPU starts, on a bad ratio
    ref = Path(reference).read_bytes() if reference else None
    png = Qwen().generate.remote(prompt, aspect_ratio, ref)
    Path(out).write_bytes(png)
    print(f"Saved {len(png) // 1024} KB to {out}")
