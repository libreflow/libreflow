-- CreateEnum
CREATE TYPE "SchemaStatus" AS ENUM ('Published', 'Review', 'Rejected', 'Deprecated', 'Archived');

-- AlterTable
ALTER TABLE "Schema" ADD COLUMN     "downloads" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "longdescription" TEXT,
ADD COLUMN     "status" "SchemaStatus" NOT NULL DEFAULT E'Review';
