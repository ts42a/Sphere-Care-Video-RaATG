jest.mock("expo-file-system", () => ({
  cacheDirectory: "file:///tmp/",
  EncodingType: { UTF8: "utf8" },
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(async () => ({ granted: false })),
    createFileAsync: jest.fn(),
  },
  writeAsStringAsync: jest.fn(async () => undefined),
}));
