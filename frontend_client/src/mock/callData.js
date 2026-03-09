export const callContacts = [
  {
    id: "sarah-wilson",
    initials: "SW",
    name: "Dr. Sarah Wilson",
    specialty: "General Practitioner",
    lastSeen: "2 hours ago",
    online: true,
    color: "blue",
  },
  {
    id: "jack-specs",
    initials: "JS",
    name: "Dr. Jack Specs",
    specialty: "General Practitioner",
    lastSeen: "1 hour ago",
    online: true,
    color: "purple",
  },
  {
    id: "michael-chen",
    initials: "MC",
    name: "Dr. Michael Chen",
    specialty: "Cardiologist",
    lastSeen: "4 hours ago",
    online: false,
    color: "teal",
  },
];

export const chatMessages = {
  "sarah-wilson": [
    {
      id: 1,
      sender: "doctor",
      text: "Good morning! How is Mrs. Anderson doing today?",
      time: "9:23 AM",
      name: "Dr. Sarah Wilson",
    },
    {
      id: 2,
      sender: "me",
      text: "Morning! She had a good night. Vitals are stable.",
      time: "9:25 AM",
    },
    {
      id: 3,
      sender: "doctor",
      text: "Have you administered her morning medication?",
      time: "9:26 AM",
      name: "Dr. Sarah Wilson",
    },
    {
      id: 4,
      sender: "me",
      text: "Yes, completed at 8:00 AM. BP 128/82, temp 98.4°F.",
      time: "9:28 AM",
    },
  ],
};

export const transcriptLines = [
  "It's more of a dull ache, especially after I've been sitting for long periods.",
  "I understand. Can you describe the intensity on a scale of 1 to 10?",
  "I'd say it's around a 6 most days, but it can spike to an 8 when I'm stressed.",
];