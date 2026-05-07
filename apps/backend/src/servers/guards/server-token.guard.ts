import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { ServersService } from "../servers.service";

@Injectable()
export class ServerTokenGuard implements CanActivate {
  constructor(private readonly serversService: ServersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers["authorization"] as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing server token");
    }

    const token = authHeader.slice(7);
    const serverId =
      (request.params.id as string | undefined) ??
      (request.params.serverId as string | undefined) ??
      (request.body?.serverId as string | undefined);
    if (!serverId) {
      throw new UnauthorizedException("Missing server ID");
    }

    const server = await this.serversService.validateServerToken(
      serverId,
      token,
    );
    if (!server) {
      throw new UnauthorizedException("Invalid server token");
    }

    request.gameServer = server;
    return true;
  }
}
