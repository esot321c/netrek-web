import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ServerConfig {
  constructor(private readonly config: ConfigService) {}

  private env(key: string, fallback?: string): string {
    return this.config.get<string>(key) ?? fallback ?? "";
  }

  get backendUrl(): string {
    return this.env("BACKEND_URL", "http://localhost:3012/v1");
  }

  get serverId(): string {
    return this.env("SERVER_ID");
  }

  get serverToken(): string {
    return this.env("SERVER_TOKEN");
  }

  get gameTokenPublicKey(): string {
    return this.env("GAME_TOKEN_PUBLIC_KEY");
  }

  get wsPort(): number {
    return parseInt(this.env("WS_PORT", "3013"), 10);
  }

  get publicWsUrl(): string {
    return this.env("PUBLIC_WS_URL", `ws://localhost:${this.wsPort}`);
  }

  get corsOrigin(): string {
    return this.env("CORS_ORIGIN", "http://localhost:3011");
  }
}
