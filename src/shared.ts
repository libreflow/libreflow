import { PrismaClient } from "@prisma/client";
import Sqids from "sqids";

export const prisma = new PrismaClient();
export const sqids = new Sqids({
	alphabet: "yJOtpFYLbScGaXPKuEimvjkWIqfzdN58ZsRD9x4wlrB12e3hT0Mo6AUH7QCngV",
	minLength: 8
})