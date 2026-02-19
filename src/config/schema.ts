import { z } from "zod/v4";

export const ConfigSchema = z.object({
	email: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
