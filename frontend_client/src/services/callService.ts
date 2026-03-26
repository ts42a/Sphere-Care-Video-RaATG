import {
  fetchCallContactById,
  fetchCallContacts,
  fetchCallSummary,
  fetchTranscript,
  createAudioCall,
  createVideoCall,
} from "../api/call";

export const callService = {
  getSummary: fetchCallSummary,
  getContacts: fetchCallContacts,
  getContactById: fetchCallContactById,
  getTranscript: fetchTranscript,
  startAudioCall: createAudioCall,
  startVideoCall: createVideoCall,
};