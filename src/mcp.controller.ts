import { All, Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { McpService } from './modules/mcp/mcp.service';

@Controller()
export class McpController {
    constructor(private readonly mcpService: McpService) { }

    @Get('health')
    getHealth() {
        return this.mcpService.getHealth();
    }

    @All('mcp')
    async handleMcp(@Req() req: Request, @Res() res: Response) {
        await this.mcpService.handleExpressRequest(req, res);
    }
}
