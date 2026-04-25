import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpController } from './mcp.controller';
import { McpService } from './modules/mcp/mcp.service';

@Module({
    imports: [ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true })],
    controllers: [McpController],
    providers: [McpService],
})
export class McpModule { }
