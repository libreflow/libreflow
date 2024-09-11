/*
  Warnings:

  - You are about to drop the column `categories` on the `Schema` table. All the data in the column will be lost.
  - Added the required column `category` to the `Schema` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `Schema` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Schema" DROP COLUMN "categories",
ADD COLUMN     "category" TEXT NOT NULL,
ALTER COLUMN "description" SET NOT NULL;
