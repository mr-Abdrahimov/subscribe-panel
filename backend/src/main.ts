import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = app.get(ConfigService);

  const swaggerConfig = new DocumentBuilder()
    .setTitle(config.get<string>('SWAGGER_TITLE') ?? 'API')
    .setDescription(config.get<string>('SWAGGER_DESCRIPTION') ?? '')
    .setVersion(config.get<string>('SWAGGER_VERSION') ?? '1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(config.get<string>('SWAGGER_PATH') ?? 'docs', app, document);

  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();
