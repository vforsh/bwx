export interface GlobalOptions {
	json?: boolean;
	plain?: boolean;
	quiet?: boolean;
	verbose?: boolean;
}

export interface CliContext {
	opts: GlobalOptions;
}
