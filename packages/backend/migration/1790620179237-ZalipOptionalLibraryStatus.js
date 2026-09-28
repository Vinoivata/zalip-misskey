/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipOptionalLibraryStatus1790620179237 {
    name = 'ZalipOptionalLibraryStatus1790620179237';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" ALTER COLUMN "status" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" ALTER COLUMN "status" DROP DEFAULT`);
    }

    async down(queryRunner) {
        // The old client requires a list status. Preserve ratings, progress and subscriptions.
        await queryRunner.query(`UPDATE "zalip_library_entry" SET "status" = 'planned' WHERE "status" IS NULL`);
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" ALTER COLUMN "status" SET DEFAULT 'planned'`);
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" ALTER COLUMN "status" SET NOT NULL`);
    }
}
