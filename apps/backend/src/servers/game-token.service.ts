import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { createPublicKey } from "crypto";
import { AppConfig } from "../config/app.config";
import { PrismaService } from "../prisma/prisma.service";
import * as jose from "jose";

export interface GameTokenPayload {
  sub: string;
  username: string;
  serverId: string;
  team: number;
  shipType: number;
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
export class GameTokenService implements OnModuleInit {
  private privateKey!: jose.CryptoKey;
  private publicKeyJwk!: jose.JWK;
  private readonly logger = new Logger(GameTokenService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const pem = this.config.gameToken.privateKey;
    if (pem) {
      this.privateKey = await jose.importPKCS8(pem, "ES256");
      // Derive public key from the private key PEM via Node crypto, then export as JWK
      const publicKeyObj = createPublicKey(pem);
      this.publicKeyJwk = await jose.exportJWK(publicKeyObj);
      this.logger.log("Loaded ES256 private key from config");
    } else {
      const { privateKey, publicKey } = await jose.generateKeyPair("ES256");
      this.privateKey = privateKey;
      this.publicKeyJwk = await jose.exportJWK(publicKey);
      this.logger.warn(
        "No GAME_TOKEN_PRIVATE_KEY configured — generated ephemeral key pair. Game tokens will not survive restarts.",
      );
    }
  }

  async signGameToken(payload: GameTokenPayload): Promise<string> {
    const ttl = this.config.gameToken.ttlSeconds;
    return new jose.SignJWT(payload as unknown as jose.JWTPayload)
      .setProtectedHeader({ alg: "ES256" })
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .sign(this.privateKey);
  }

  getPublicKeyJwk(): jose.JWK {
    return this.publicKeyJwk;
  }

  async getPlayerStats(userId: string, serverId: string, isOfficial: boolean) {
    const scope = isOfficial ? "official" : serverId;
    const stats = await this.prisma.playerStats.findUnique({
      where: { userId_serverId: { userId, serverId: scope } },
    });
    return {
      totalKills: stats?.totalKills ?? 0,
      totalDeaths: stats?.totalDeaths ?? 0,
      totalWins: stats?.totalWins ?? 0,
      totalLosses: stats?.totalLosses ?? 0,
      planetsTaken: stats?.planetsTaken ?? 0,
      armiesBombed: stats?.armiesBombed ?? 0,
      armiesBeamed: stats?.armiesBeamed ?? 0,
      secondsPlayed: stats?.secondsPlayed ?? 0,
      rank: stats?.rank ?? 0,
    };
  }
}
