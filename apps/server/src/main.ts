import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";
import { ServerConfig } from "./config/server.config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ServerConfig);

  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({
    origin: config.corsOrigin,
    credentials: true,
  });

  await app.listen(config.wsPort);
  console.log(`Game server listening on port ${config.wsPort}`);
}
bootstrap();
