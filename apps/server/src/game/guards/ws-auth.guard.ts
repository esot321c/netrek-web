import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { ServerConfig } from "../../config/server.config";
import * as jose from "jose";
import type { Socket } from "socket.io";

export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
  isGuest?: boolean;
  stats: {
    totalKills: number;
    totalDeaths: number;
    totalWins: number;
    totalLosses: number;
    planetsTaken: number;
    armiesBombed: number;
    armiesBeamed: number;
    secondsPlayed: number;
    rank: number;
  };
}

@Injectable()
export class WsAuthService implements OnModuleInit {
  private publicKey: jose.CryptoKey | Uint8Array | null = null;
  private readonly logger = new Logger(WsAuthService.name);

  constructor(private readonly config: ServerConfig) {}

  async onModuleInit() {
    const jwkStr = this.config.gameTokenPublicKey;
    if (jwkStr) {
      try {
        const jwk = JSON.parse(jwkStr);
        this.publicKey = await jose.importJWK(jwk, "ES256");
        this.logger.log("Loaded game token public key");
      } catch (err) {
        this.logger.error(
          `Failed to load public key: ${(err as Error).message}`,
        );
      }
    }

    if (!this.publicKey) {
      this.logger.warn(
        "No GAME_TOKEN_PUBLIC_KEY configured — will fetch from backend on first connection",
      );
    }
  }

  private async fetchPublicKey(): Promise<void> {
    try {
      const url = `${this.config.backendUrl}/servers/public-key`;
      const res = await fetch(url);
      const jwk = await res.json();
      this.publicKey = await jose.importJWK(jwk, "ES256");
      this.logger.log("Fetched game token public key from backend");
    } catch (err) {
      this.logger.error(
        `Failed to fetch public key: ${(err as Error).message}`,
      );
    }
  }

  async validateSocket(client: Socket): Promise<GameTokenPayload | null> {
    try {
      const token =
        (client.handshake.auth?.["token"] as string | undefined) ??
        client.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        this.logger.warn("No game token in handshake");
        return null;
      }

      if (!this.publicKey) {
        await this.fetchPublicKey();
      }

      if (!this.publicKey) {
        this.logger.error("No public key available");
        return null;
      }

      const { payload } = await jose.jwtVerify(token, this.publicKey, {
        algorithms: ["ES256"],
      });

      return payload as unknown as GameTokenPayload;
    } catch (err) {
      this.logger.warn(
        `Game token validation failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
