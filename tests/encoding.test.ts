import { describe, expect, test } from "bun:test";
import {
	parseFieldFlag,
	buildNewItem,
	patchItem,
	bwEncode,
} from "../src/bw/encoding.ts";

describe("parseFieldFlag", () => {
	test("plain key=value → Text field", () => {
		const f = parseFieldFlag("account=test@example.com");
		expect(f.name).toBe("account");
		expect(f.value).toBe("test@example.com");
		expect(f.type).toBe(0); // Text
	});

	test("!key=value → Hidden field", () => {
		const f = parseFieldFlag("!secret=abc123");
		expect(f.name).toBe("secret");
		expect(f.value).toBe("abc123");
		expect(f.type).toBe(1); // Hidden
	});

	test("bool:key=value → Boolean field", () => {
		const f = parseFieldFlag("bool:active=true");
		expect(f.name).toBe("active");
		expect(f.value).toBe("true");
		expect(f.type).toBe(2); // Boolean
	});

	test("bool:key without value defaults to 'true'", () => {
		const f = parseFieldFlag("bool:enabled");
		expect(f.name).toBe("enabled");
		expect(f.value).toBe("true");
		expect(f.type).toBe(2);
	});

	test("key without = → empty value", () => {
		const f = parseFieldFlag("tag");
		expect(f.name).toBe("tag");
		expect(f.value).toBe("");
		expect(f.type).toBe(0);
	});

	test("value containing = is preserved", () => {
		const f = parseFieldFlag("url=https://example.com?a=b&c=d");
		expect(f.name).toBe("url");
		expect(f.value).toBe("https://example.com?a=b&c=d");
	});
});

describe("buildNewItem", () => {
	test("builds a secure note", () => {
		const item = buildNewItem({
			name: "Test Note",
			notes: "secret content",
			fields: [parseFieldFlag("account=test")],
		});
		expect(item.type).toBe(2); // SecureNote
		expect(item.name).toBe("Test Note");
		expect(item.notes).toBe("secret content");
		expect(item.secureNote).toEqual({ type: 0 });
		expect(item.login).toBeNull();
		expect(item.fields).toEqual([
			{ name: "account", value: "test", type: 0 },
		]);
	});

	test("builds a login item", () => {
		const item = buildNewItem({
			type: "login",
			name: "GitHub",
			username: "user@example.com",
			password: "hunter2",
			uris: ["https://github.com"],
		});
		expect(item.type).toBe(1); // Login
		expect(item.login).toEqual({
			username: "user@example.com",
			password: "hunter2",
			totp: null,
			uris: [{ match: null, uri: "https://github.com" }],
		});
		expect(item.secureNote).toBeUndefined();
	});

	test("defaults to note type", () => {
		const item = buildNewItem({ name: "X" });
		expect(item.type).toBe(2);
	});

	test("sets favorite and folderId", () => {
		const item = buildNewItem({
			name: "Y",
			favorite: true,
			folderId: "abc-123",
		});
		expect(item.favorite).toBe(true);
		expect(item.folderId).toBe("abc-123");
	});

	test("null fields when none provided", () => {
		const item = buildNewItem({ name: "Z" });
		expect(item.fields).toBeNull();
	});
});

describe("patchItem", () => {
	const base = {
		id: "abc",
		type: 1,
		name: "Original",
		notes: "old notes",
		favorite: false,
		folderId: null,
		login: {
			username: "user",
			password: "pass",
			totp: null,
			uris: [{ match: null, uri: "https://old.com" }],
		},
		fields: [{ name: "env", value: "prod", type: 0 }],
	};

	test("patches name and notes", () => {
		const patched = patchItem(base, { name: "New Name", notes: "new notes" });
		expect(patched.name).toBe("New Name");
		expect(patched.notes).toBe("new notes");
		expect(patched.id).toBe("abc"); // preserved
	});

	test("patches login fields", () => {
		const patched = patchItem(base, {
			username: "newuser",
			password: "newpass",
		});
		const login = patched.login as Record<string, unknown>;
		expect(login.username).toBe("newuser");
		expect(login.password).toBe("newpass");
	});

	test("replaces URIs", () => {
		const patched = patchItem(base, {
			uris: ["https://new.com", "https://also.com"],
		});
		const login = patched.login as Record<string, unknown>;
		expect(login.uris).toEqual([
			{ match: null, uri: "https://new.com" },
			{ match: null, uri: "https://also.com" },
		]);
	});

	test("adds a new field", () => {
		const patched = patchItem(base, {
			addFields: [{ name: "region", value: "us-east-1", type: 0 }],
		});
		const fields = patched.fields as Array<{ name: string; value: string }>;
		expect(fields).toHaveLength(2);
		expect(fields[1]!.name).toBe("region");
	});

	test("updates existing field by name", () => {
		const patched = patchItem(base, {
			addFields: [{ name: "env", value: "staging", type: 0 }],
		});
		const fields = patched.fields as Array<{ name: string; value: string }>;
		expect(fields).toHaveLength(1);
		expect(fields[0]!.value).toBe("staging");
	});

	test("removes a field", () => {
		const patched = patchItem(base, { rmFields: ["env"] });
		expect(patched.fields).toBeNull();
	});

	test("remove then add in same patch", () => {
		const patched = patchItem(base, {
			rmFields: ["env"],
			addFields: [{ name: "stage", value: "dev", type: 0 }],
		});
		const fields = patched.fields as Array<{ name: string; value: string }>;
		expect(fields).toHaveLength(1);
		expect(fields[0]!.name).toBe("stage");
	});

	test("does not mutate original", () => {
		patchItem(base, { name: "Changed" });
		expect(base.name).toBe("Original");
	});

	test("sets favorite", () => {
		const patched = patchItem(base, { favorite: true });
		expect(patched.favorite).toBe(true);
	});
});

describe("bwEncode", () => {
	test("base64 encodes string", () => {
		expect(bwEncode('{"name":"test"}')).toBe(
			Buffer.from('{"name":"test"}').toString("base64"),
		);
	});

	test("handles unicode", () => {
		const input = '{"name":"тест"}';
		expect(bwEncode(input)).toBe(Buffer.from(input).toString("base64"));
	});

	test("handles empty string", () => {
		expect(bwEncode("")).toBe("");
	});
});
