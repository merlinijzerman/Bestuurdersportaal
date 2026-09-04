export function veiligeMicrosoftReturnUrl(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/profiel";
  return value;
}
