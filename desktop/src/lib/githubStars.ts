export async function donationAvailable(): Promise<boolean> {
  try {
    const response = await fetch("https://api.github.com/repos/Kevinlabs26/WAP-Plus-CRM", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    const stars = (data as { stargazers_count?: unknown } | null)?.stargazers_count;
    return typeof stars === "number" && Number.isSafeInteger(stars) && stars > 1000;
  } catch {
    return false;
  }
}
