import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { confirmEmailChange } from "@/server/auth/email-change";

export const POST = route(async (req) => json(await confirmEmailChange(await getDb(), await readJson(req))));
