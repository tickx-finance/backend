import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const SKILL_ROOT = resolve(process.cwd(), 'skills', 'tapfun-agent-betting');

@Controller()
export class SkillDocsController {
    @Get('skill.md')
    getRootSkill(@Res() res: Response) {
        const skillPath = resolve(SKILL_ROOT, 'SKILL.md');
        if (!existsSync(skillPath)) {
            throw new NotFoundException('skill not found');
        }
        res.type('text/markdown');
        res.sendFile(skillPath);
    }

    @Get('skills/*')
    getSkillAsset(@Req() req: Request, @Res() res: Response) {
        const path = req.params[0];
        const targetPath = resolve(SKILL_ROOT, path);
        if (!targetPath.startsWith(`${SKILL_ROOT}${sep}`) && targetPath !== SKILL_ROOT) {
            throw new NotFoundException('skill asset not found');
        }
        if (!existsSync(targetPath)) {
            throw new NotFoundException('skill asset not found');
        }

        if (targetPath.endsWith('.md')) {
            res.type('text/markdown');
        }
        res.sendFile(targetPath);
    }
}
