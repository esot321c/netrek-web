import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServerConfig } from "./server.config";

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [ServerConfig],
  exports: [ServerConfig],
})
export class ServerConfigModule {}
