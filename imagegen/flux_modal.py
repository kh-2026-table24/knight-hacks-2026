"""FLUX.2 [klein] 4B image generation on a Modal cloud GPU.

Runs the open-weight model from Hugging Face (black-forest-labs/FLUX.2-klein-4B, Apache 2.0) behind
one HTTPS endpoint, so the game server can call it in place of Gemini. The same model draws from text
and redraws a reference image, so later animation frames keep their first frame's style.

Setup, once:
    pip install modal && modal setup
    modal secret create huggingface-secret HF_TOKEN=hf_...
Try it (draws on the cloud GPU, saves the result locally):
    modal run imagegen/flux_modal.py::main --prompt "a rusty lantern" --aspect-ratio 3:4
    modal run imagegen/flux_modal.py::main --prompt "the same lantern, flame flickering" --reference /tmp/flux-test.png
Draw a character and its animation frames the way the game does, with timings:
    modal run imagegen/flux_modal.py::character_test
Deploy the endpoint (prints its URL):
    modal deploy imagegen/flux_modal.py

Endpoint: POST JSON {"prompt": str, "aspect_ratio": "9:16", "reference": base64 image (optional),
"seed": int (optional)} -> image/png. It requires proxy auth: send the Modal-Key and Modal-Secret
headers from a proxy auth token (Modal dashboard -> Settings -> Proxy Auth Tokens).
"""

import base64
import binascii
import io
import re
import time
from pathlib import Path

import modal

MODEL_ID = "black-forest-labs/FLUX.2-klein-4B"
CACHE_DIR = "/cache"
MINUTES = 60

# klein is distilled to draw in a few steps without classifier-free guidance; these are the model card's values.
STEPS = 4
GUIDANCE = 1.0

# Every image is shrunk to 128px or less by the game server, so draw as small as the model stays coherent.
# FLUX works on a grid 1/16 the image's size, and below ~512px it runs out of room to form a subject.
# Sides must be multiples of 16; very wide or tall shapes keep their short side at MIN_SIDE.
TARGET_PIXELS = 1024 * 1024
MIN_SIDE = 256

# Weights are stored in fp8 (half of bf16) and widened to bf16 one layer at a time as they run, so half
# as many bytes move onto the GPU at startup. Set False if images come out noticeably worse.
FP8_WEIGHTS = True

# One warm container draws an image in well under a second, while a second container would spend
# 30+ s starting up. Extra requests queue for the warm one instead of starting more GPUs.
MAX_CONTAINERS = 1
MAX_PROMPT_CHARS = 4000
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
ASPECT_RATIO = re.compile(r"^([1-9]|1[0-9]|2[01]):([1-9]|1[0-9]|2[01])$")  # 1:1 up to 21:9, like Gemini's set

# Versions are left unpinned so the build gets a diffusers release with Flux2KleinPipeline;
# pin them once a working set is confirmed so a later release can't break the demo.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("torch", "diffusers", "transformers", "accelerate", "pillow", "fastapi[standard]")
    .env({"HF_HUB_CACHE": CACHE_DIR})
)

app = modal.App("paradise-flux", image=image)

# The weights (~16 GB) download once into this volume instead of on every cold start.
hf_cache = modal.Volume.from_name("paradise-flux-hf-cache", create_if_missing=True)

with image.imports():
    import torch
    from diffusers import Flux2KleinPipeline
    from diffusers.hooks import apply_layerwise_casting
    from fastapi import HTTPException, Response
    from PIL import Image


def size_for(aspect_ratio: str) -> tuple[int, int]:
    """Width and height for an aspect ratio like "9:16", near TARGET_PIXELS, both multiples of 16."""
    match = ASPECT_RATIO.match(aspect_ratio)
    if not match:
        raise ValueError(f'aspect_ratio must look like "9:16" (sides 1 to 21), got {aspect_ratio!r}')
    w, h = int(match[1]), int(match[2])
    scale = max((TARGET_PIXELS / (w * h)) ** 0.5, MIN_SIDE / min(w, h))
    return round(w * scale / 16) * 16, round(h * scale / 16) * 16


# L40S (48 GB) holds the pipeline with room to spare and is quick; "A10G" (24 GB) also fits and costs
# less. Containers stay warm for a while after the last request so a game's burst of images doesn't pay
# a cold start each time. Requests are handled one at a time per container: the pipeline isn't safe to
# call from two threads, and the GPU is already fully busy with one image.
@app.cls(
    gpu="L40S",
    volumes={CACHE_DIR: hf_cache},
    secrets=[modal.Secret.from_name("huggingface-secret")],
    scaledown_window=10 * MINUTES,
    timeout=10 * MINUTES,
    max_containers=MAX_CONTAINERS,
    # Once deployed, Modal saves the container's memory after load() and restores it on later cold
    # starts, skipping the imports, the disk read and the fp8 conversion. `modal run` doesn't snapshot.
    enable_memory_snapshot=True,
)
class Flux:
    @modal.enter(snap=True)
    def load(self) -> None:
        # No GPU work here: the GPU isn't attached while the snapshot is taken.
        self.pipe = Flux2KleinPipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
        if FP8_WEIGHTS:
            # The transformer and text encoder are nearly all of the bytes; the small VAE stays bf16.
            self.pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
            apply_layerwise_casting(self.pipe.text_encoder, storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
        hf_cache.commit()  # keep a first-run download for the next container

    @modal.enter(snap=False)
    def to_gpu(self) -> None:
        started = time.perf_counter()
        self.pipe.to("cuda")
        print(f"moved the model onto the GPU in {time.perf_counter() - started:.1f} s")

    def draw(self, prompt: str, aspect_ratio: str, reference: bytes | None, seed: int | None) -> bytes:
        width, height = size_for(aspect_ratio)
        started = time.perf_counter()
        extra = {}
        if reference is not None:
            extra["image"] = Image.open(io.BytesIO(reference)).convert("RGB")
        if seed is not None:
            extra["generator"] = torch.Generator("cuda").manual_seed(seed)
        # The pipeline gives prompt embeddings its text encoder's weight type, which is fp8 when FP8_WEIGHTS
        # is on, and the GPU can't draw starting noise in fp8. Encoding here lets us ask for bf16.
        prompt_embeds = self.pipe._get_qwen3_prompt_embeds(
            self.pipe.text_encoder, self.pipe.tokenizer, prompt, dtype=torch.bfloat16, device=torch.device("cuda")
        )
        result = self.pipe(
            prompt_embeds=prompt_embeds,
            width=width,
            height=height,
            num_inference_steps=STEPS,
            guidance_scale=GUIDANCE,
            **extra,
        ).images[0]
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
def character_test(subject: str = "scruffy brown terrier dog", aspect_ratio: str = "3:2", out_dir: str = "/tmp/flux-dog") -> None:
    """Draws one character the way the game server does, and times each image.

    The first frame is drawn from text; every other frame is drawn from it as a reference, so they
    match. Run: modal run imagegen/flux_modal.py::character_test
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
    flux = Flux()
    timings = {}

    def save(name: str, prompt: str, reference: bytes | None) -> bytes:
        started = time.perf_counter()
        png = flux.generate.remote(prompt, aspect_ratio, reference)
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
def main(prompt: str = "a rusty iron lantern", aspect_ratio: str = "1:1", reference: str = "", out: str = "/tmp/flux-test.png") -> None:
    size_for(aspect_ratio)  # fail here, before a GPU starts, on a bad ratio
    ref = Path(reference).read_bytes() if reference else None
    png = Flux().generate.remote(prompt, aspect_ratio, ref)
    Path(out).write_bytes(png)
    print(f"Saved {len(png) // 1024} KB to {out}")
