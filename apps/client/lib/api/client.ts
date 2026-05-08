const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3012/v1";

function getCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith("csrf_token="));
  return match?.split("=").slice(1).join("=");
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const csrfToken = getCsrfToken();

  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrfToken && { "x-csrf-token": csrfToken }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `API error ${res.status}`);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function joinServer(
  serverId: string,
  team: number,
  shipType: number,
): Promise<{ gameToken: string; wsUrl: string }> {
  return apiFetch(`/servers/${serverId}/join`, {
    method: "POST",
    body: JSON.stringify({ team, shipType }),
  });
}

export async function fetchServers() {
  return apiFetch<any[]>("/servers");
}

export async function fetchServer(id: string) {
  return apiFetch<any>(`/servers/${id}`);
}

export async function joinGuestServer(
  serverId: string,
  team: number,
  shipType: number,
): Promise<{ gameToken: string; wsUrl: string }> {
  return apiFetch(`/servers/${serverId}/join-guest`, {
    method: "POST",
    body: JSON.stringify({ team, shipType }),
  });
}

export async function updateUsername(
  username: string,
): Promise<{ id: string; username: string; usernameSet: boolean }> {
  return apiFetch(`/auth/username`, {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });
}
