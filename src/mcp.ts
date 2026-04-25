import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { McpModule } from './mcp.module';
import { McpService } from './modules/mcp/mcp.service';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(McpModule, {
        logger: new Logger('[]'),
    });
    const logger = new Logger('MCP');
    const host = process.env.MCP_HOST ?? '0.0.0.0';
    const port = Number(process.env.MCP_PORT ?? 3010);

    app.useLogger(logger);
    app.enableShutdownHooks();

    const mcpService = app.get(McpService);
    app.enableShutdownHooks();

    process.on('SIGINT', async () => {
        await mcpService.shutdown();
    });
    process.on('SIGTERM', async () => {
        await mcpService.shutdown();
    });

    await app.listen(port, host, () => {
        logger.warn(`MCP process started on http://${host}:${port}`);
    });
}

bootstrap();
