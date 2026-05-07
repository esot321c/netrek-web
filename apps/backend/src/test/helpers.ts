import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  module: TestingModule;
}> {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = module.createNestApplication();
  app.setGlobalPrefix("v1");
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const prisma = module.get(PrismaService);

  return { app, prisma, module };
}

export async function createAuthenticatedUser(
  prisma: PrismaService,
  module: TestingModule,
  overrides: { email?: string; name?: string } = {},
): Promise<{
  user: { id: string; email: string };
  session: { id: string };
  token: string;
  authHeader: string;
}> {
  const email = overrides.email ?? `test-${crypto.randomUUID()}@test.com`;
  const username = email.split("@")[0]!;

  const user = await prisma.user.create({
    data: {
      email,
      username,
      name: overrides.name ?? username,
    },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenFamily: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
    },
  });

  const jwtService = module.get(JwtService);
  const token = jwtService.sign({
    sub: user.id,
    email: user.email,
    roles: user.roles,
    sessionId: session.id,
    tokenFamily: session.tokenFamily,
  });

  return {
    user: { id: user.id, email: user.email },
    session: { id: session.id },
    token,
    authHeader: `Bearer ${token}`,
  };
}

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
}
