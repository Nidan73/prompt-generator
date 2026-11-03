// Shapes a prompt as a chat-completions style request body for the API Mode view.
export function buildApiModeOutput(prompt: string, modelName: string | undefined): string {
  return JSON.stringify(
    {
      model: modelName || "recommended-model",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Execute the task described above." },
      ],
    },
    null,
    2,
  );
}
