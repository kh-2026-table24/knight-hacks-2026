export interface RepairContext {
  /** The previous attempt's JSON, or its raw text if it didn't parse. */
  previous: string;
  problems: string[];
}

/** Appended to a prompt when the previous answer failed validation. */
export const repairSection = ({ previous, problems }: RepairContext, tag: string, howToFix: string) => `
<previous_attempt>
${previous}
</previous_attempt>

<problems>
${problems.map((p) => `- ${p}`).join("\n")}
</problems>

Your previous attempt (above) failed the checks with the problems listed. Fix every problem while
changing as little else as possible: ${howToFix}. Respond in the same format; keep the notes to a
short list of your changes, then give the complete corrected <${tag}>.
`;
