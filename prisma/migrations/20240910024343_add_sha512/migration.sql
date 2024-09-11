/*
  Warnings:

  - Added the required column `sha512` to the `Schema` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Schema" ADD COLUMN     "sha512" TEXT NOT NULL;
