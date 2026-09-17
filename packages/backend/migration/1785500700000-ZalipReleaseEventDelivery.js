/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipReleaseEventDelivery1785500700000 {
    name = 'ZalipReleaseEventDelivery1785500700000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_release_event" ADD "notificationDeliveredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`UPDATE "zalip_release_event" SET "notificationDeliveredAt" = "createdAt"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_release_event" DROP COLUMN "notificationDeliveredAt"`);
    }
}
