import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserAuthProfilesPhase11777000000000 implements MigrationInterface {
    name = 'UserAuthProfilesPhase11777000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TYPE "public"."user_auth_profiles_lastauthtype_enum" AS ENUM(
                'wallet',
                'miniapp'
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "user_auth_profiles" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "address" character varying NOT NULL,
                "lastAuthType" "public"."user_auth_profiles_lastauthtype_enum" NOT NULL DEFAULT 'wallet',
                "miniAppUserId" character varying,
                "humanVerified" boolean NOT NULL DEFAULT false,
                "humanVerifiedAt" TIMESTAMP,
                "humanVerificationSource" text,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_user_auth_profiles_address" UNIQUE ("address"),
                CONSTRAINT "PK_user_auth_profiles" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "user_auth_profiles"`);
        await queryRunner.query(`DROP TYPE "public"."user_auth_profiles_lastauthtype_enum"`);
    }
}
