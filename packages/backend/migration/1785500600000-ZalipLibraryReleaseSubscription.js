/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipLibraryReleaseSubscription1785500600000 {
    name = 'ZalipLibraryReleaseSubscription1785500600000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" ADD "isReleaseSubscribed" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_library_user_release_subscription" ON "zalip_library_entry" ("userId", "isReleaseSubscribed")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_library_user_release_subscription"`);
        await queryRunner.query(`ALTER TABLE "zalip_library_entry" DROP COLUMN "isReleaseSubscribed"`);
    }
}
