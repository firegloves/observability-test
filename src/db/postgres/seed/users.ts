// Generate 100 users for testing
export const users: Array<{
	id: number;
	email: string;
	password_hash: string;
	name: string;
}> = [];

// Add the original 2 users
users.push(
	{
		id: 1,
		email: "kotomi@test.com",
		password_hash: "test",
		name: "Kotomi",
	},
	{
		id: 2,
		email: "mark@test.com",
		password_hash: "test",
		name: "Mark",
	},
);

// Generate 98 additional test users (3-100)
for (let i = 3; i <= 100; i++) {
	users.push({
		id: i,
		email: `testuser${i}@example.com`,
		password_hash: "test_hash",
		name: `Test User ${i}`,
	});
}
