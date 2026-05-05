import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Socket } from "socket.io";
import { type JwtPayload } from "../../auth/types/jwt.types";

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(private readonly jwtService: JwtService) {}

  /** Validate a Socket.IO handshake and return the JWT payload, or null. */
  async validateSocket(client: Socket): Promise<JwtPayload | null> {
    try {
      // Try handshake auth token first (Bearer), then cookies
      let token: string | undefined;

      const authToken = client.handshake.auth?.["token"] as string | undefined;
      if (authToken) {
        token = authToken.startsWith("Bearer ")
          ? authToken.slice(7)
          : authToken;
      }

      if (!token) {
        // Try cookie
        const cookies = client.handshake.headers.cookie;
        if (cookies) {
          const match = cookies.match(/auth_token=([^;]+)/);
          if (match?.[1]) {
            token = match[1];
          }
        }
      }

      if (!token) {
        this.logger.warn("WS connection rejected: no token");
        return null;
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return payload;
    } catch {
      this.logger.warn("WS connection rejected: invalid token");
      return null;
    }
  }
}
