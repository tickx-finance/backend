import { Module } from '@nestjs/common';
import { SkillDocsController } from './skill-docs.controller';

@Module({
    controllers: [SkillDocsController],
})
export class SkillDocsModule { }
