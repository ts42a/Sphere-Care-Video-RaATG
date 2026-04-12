import {
  fetchCallContactById,
  fetchCallContacts,
  fetchCallSummary,
  fetchTranscript,
  startCall,
  muteCall,
  endCall,
  stopCall,
  fetchCurrentCall,
} from "../api/call";

export const callService = {
  getSummary: fetchCallSummary,
  getContacts: fetchCallContacts,
  getContactById: fetchCallContactById,
  startCall,
  getCurrentCall: fetchCurrentCall,
  getTranscript: fetchTranscript,
  muteCall,
  endCall,
  stopCall,
};