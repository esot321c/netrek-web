export enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
}

export interface CurrentUser {
  id: string;
  email: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  roles: Role[];
}

export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
  expiresAt: string;
  createdAt: string;
}
