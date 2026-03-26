import { USE_MOCK_API } from "../config/api";
import { request } from "./client";
import type { ApiActionResponse, ApiItemResponse } from "../types/api";
import type { CallContact, CallSummary } from "../types/call";
import { mockCallContacts, mockCallSummary } from "../mock/callData";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCallSummary(): Promise<CallSummary> {
  if (USE_MOCK_API) {
    await wait(150);
    return mockCallSummary;
  }

  const response = await request<ApiItemResponse<CallSummary>>("/calls/summary");
  return response.data;
}

export async function fetchCallContacts(search = ""): Promise<CallContact[]> {
  if (USE_MOCK_API) {
    await wait(150);

    const keyword = search.trim().toLowerCase();

    if (!keyword) return mockCallContacts;

    return mockCallContacts.filter((item) =>
      `${item.name} ${item.specialty} ${item.id}`
        .toLowerCase()
        .includes(keyword)
    );
  }

  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const response = await request<{ success: boolean; data: CallContact[] }>(
    `/contacts${query}`
  );
  return response.data;
}

export async function fetchCallContactById(contactId: string): Promise<CallContact> {
  if (USE_MOCK_API) {
    await wait(120);

    const contact = mockCallContacts.find((item) => item.id === contactId);

    if (!contact) {
      throw new Error("Contact not found");
    }

    return contact;
  }

  const response = await request<ApiItemResponse<CallContact>>(`/contacts/${contactId}`);
  return response.data;
}

export async function createAudioCall(contactId: string) {
  if (USE_MOCK_API) {
    await wait(120);
    return {
      success: true,
      data: {
        callId: `audio-${contactId}-${Date.now()}`,
      },
    };
  }

  return request<ApiActionResponse<{ callId: string }>>("/calls/audio/start", {
    method: "POST",
    body: { contactId },
  });
}

export async function createVideoCall(contactId: string) {
  if (USE_MOCK_API) {
    await wait(120);
    return {
      success: true,
      data: {
        callId: `video-${contactId}-${Date.now()}`,
      },
    };
  }

  return request<ApiActionResponse<{ callId: string }>>("/calls/video/start", {
    method: "POST",
    body: { contactId },
  });
}

export async function fetchTranscript(contactId: string): Promise<string[]> {
  if (USE_MOCK_API) {
    await wait(120);
    return [
      "Please continue monitoring blood pressure after lunch.",
      "The patient looks more stable than yesterday.",
      "I will review the medication chart after this call.",
    ];
  }

  const response = await request<{ success: boolean; data: string[] }>(
    `/calls/${contactId}/transcript`
  );
  return response.data;
}