export const ExitCode = {
	OK: 0,
	Unknown: 1,
	BadArgs: 2,
	AuthFailed: 3,
	NotFound: 4,
	BwError: 5,
	Network: 6,
	Config: 7,
	Timeout: 8,
	UserCancelled: 9,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class CliError extends Error {
	constructor(
		message: string,
		public readonly exitCode: ExitCode = ExitCode.Unknown,
	) {
		super(message);
		this.name = "CliError";
	}
}

const BW_STDERR_PATTERNS: Array<[RegExp, ExitCode]> = [
	[/not logged in|unauthenticated/i, ExitCode.AuthFailed],
	[/vault is locked/i, ExitCode.AuthFailed],
	[/not found/i, ExitCode.NotFound],
	[/more than one result/i, ExitCode.BadArgs],
	[/timed? ?out/i, ExitCode.Timeout],
	[/network|ECONNREFUSED|ENOTFOUND/i, ExitCode.Network],
];

export function classifyBwError(stderr: string): ExitCode {
	for (const [pattern, code] of BW_STDERR_PATTERNS) {
		if (pattern.test(stderr)) return code;
	}
	return ExitCode.BwError;
}
