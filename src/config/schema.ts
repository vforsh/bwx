import { z } from "zod/v4";

export const ConfigSchema = z.object({
	// Reserved for future preferences
});

export type Config = z.infer<typeof ConfigSchema>;
