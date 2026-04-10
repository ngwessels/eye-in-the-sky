import { config } from "./config.js";

export async function stationFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${config.cloudBaseUrl}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.stationApiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
}
