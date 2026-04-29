
import json


clean_conversations = {
    "Staff-Resident": [
        "Good morning, Mr Lee. Did you sleep well last night? Are you feeling any pain today? I will check your blood pressure now. Please sit comfortably on the chair. Your breakfast will arrive soon. The nurse will bring your medicine after breakfast. Would you like some water? I will come back in thirty minutes. Please press the call button if you need help.",
        "Hello, Mrs Tan. It is time for your afternoon walk. Do you feel strong enough to walk today? I can support you while we move slowly. We will walk only a short distance. Please tell me if you feel tired. After the walk, you can rest in your room. Your family called earlier to check on you. They said they will visit tomorrow. I will remind you again later.",
        "Hi, Mr Wong. Your lunch is ready. Would you like to eat at the table? I can help you move from the bed. Please take your time. The soup may still be warm. You should drink some water with your meal. After lunch, we will check your medication. The doctor will visit you this evening. I will update your care notes after this.",
        "Good evening, Mrs Lim. I am here to help you get ready for bed. Have you brushed your teeth? I will prepare your night clothes. Your room temperature is comfortable. I will close the curtains now. Your night medicine is on the tray. Please take it with water. I will switch off the main light. Call me if you need anything during the night.",
        "Hello, Mr Brown. The physiotherapist will see you today. They will help you with gentle exercises. Please wear comfortable shoes. I will bring your walking frame. Do not rush when you stand up. Tell us if you feel dizzy. The session should take about twenty minutes. After that, you can rest. I will record your progress in the system.",
        "Good morning, Mrs Chen. Your appointment is scheduled for ten o'clock. I will help you get ready soon. Please bring your glasses with you. The transport will arrive at nine thirty. We should leave the room early. I have packed your medical documents. The doctor will review your condition today. I will stay with you during the appointment. We will return before lunch if everything is on time.",
        "Hi, Mr Smith. I noticed you did not eat much today. Are you feeling unwell? Would you like a lighter meal? I can ask the kitchen for some soup. It is important to eat a little. Your medicine may upset your stomach if you skip meals. I will inform the nurse about this. Please try a few bites first. I will check on you again later.",
        "Hello, Mrs Davis. Your daughter sent you a message. She said she misses you. Would you like me to read it aloud? She will call you this evening. I can help you answer the phone. You looked happy when she visited last week. She also asked about your health. I told her you were doing better today. I will remind you before the call.",
        "Good afternoon, Mr Ahmad. It is time to check your wound dressing. Please lie down carefully. I will wash my hands first. You may feel slight discomfort. Tell me immediately if it hurts. The wound looks cleaner today. I will replace the dressing now. The nurse will review it again tomorrow. You are healing well.",
        "Hello, Mrs Green. You have a group activity this afternoon. The activity is music and memory games. Would you like to join? Some of your friends will be there. I can take you to the activity room. You do not need to stay if you feel tired. It may help you feel more relaxed. The session starts at two o'clock. Please let me know your decision."
    ],

    "Staff-Doctor": [
        "Doctor, I am calling about Mr Lee. He has had a mild fever since this morning. His temperature is thirty eight degrees. He also reported feeling weak. His blood pressure is stable. He has taken his morning medicine. He is drinking water normally. There is no shortness of breath. Should we continue monitoring him? Please advise if any medication is needed.",
        "Doctor, Mrs Tan fell in the bathroom. She did not lose consciousness. There is slight swelling on her left ankle. She says the pain is moderate. We helped her back to bed safely. Her vital signs are normal. She can move her toes. We have applied a cold pack. Would you like to examine her today? I will keep her family updated.",
        "Doctor, I need advice about Mr Wong's medication. He refused his evening tablets. He said they made him feel dizzy yesterday. He has not vomited today. His appetite is slightly reduced. His blood pressure is lower than usual. The nurse asked me to contact you. Should we hold the medication tonight? Please confirm the next step. I will document your instruction.",
        "Doctor, Mrs Lim has been coughing frequently. The cough started two days ago. She does not have chest pain. Her oxygen level is ninety six percent. She feels tired but remains alert. She is eating small meals. We encouraged her to drink warm water. There is no visible breathing difficulty. Would you recommend a review? Please advise if we need further observation.",
        "Doctor, Mr Brown seems more confused today. He asked the same question many times. He did not recognise one staff member. This is unusual for him. His temperature is normal. His blood sugar was checked this morning. The result was within range. He slept poorly last night. Should we monitor for delirium? Please let us know if you need more information.",
        "Doctor, Mrs Chen has reduced mobility today. She says her right knee is painful. There is no redness around the joint. She can still stand with support. She refused the walking exercise this morning. We gave her time to rest. Her pain score is six out of ten. She has taken her prescribed pain relief. Would you like to adjust her care plan? I will update the physiotherapist as well.",
        "Doctor, Mr Smith has not opened his bowels for three days. He feels uncomfortable after meals. His abdomen is slightly bloated. He is still passing gas. He has no vomiting. He has been drinking less water. We encouraged more fluids today. He is taking his regular medication. Should we give a laxative? Please confirm before we proceed.",
        "Doctor, Mrs Davis reported chest tightness. The symptom started after breakfast. She is anxious but alert. Her oxygen level is ninety seven percent. Her pulse is slightly fast. We asked her to rest in bed. The nurse is monitoring her closely. She says the tightness is improving. Do you want an urgent assessment? Please advise us as soon as possible.",
        "Doctor, Mr Ahmad's wound dressing was changed today. The wound looks less red than yesterday. There is a small amount of clear fluid. There is no bad smell. He says the pain has reduced. His temperature is normal. We cleaned the area carefully. A new dressing was applied. Should we continue the same dressing plan? I will send a photo if needed.",
        "Doctor, Mrs Green has been refusing food. She says she has no appetite. She drank tea this morning. She ate only two spoons of porridge. Her mood seems low. She answered questions slowly. Her family visited yesterday. There was no reported argument. Should we arrange a mental health review? Please advise how we should support her."
    ],

    "Staff-Family": [
        "Hello, I am calling about your father. He is doing well today. He ate most of his breakfast. He joined the morning activity. He was a little tired afterward. The nurse checked his blood pressure. The result was stable. He asked when you will visit. You can visit tomorrow afternoon. Please call us if you need to change the time.",
        "Hi, I want to update you about your mother. She had a small fall this morning. She is safe now. The doctor has been informed. There is slight swelling on her ankle. She is resting in bed. We are monitoring her closely. She did not lose consciousness. We will contact you if anything changes. You are welcome to visit later today.",
        "Hello, your grandmother was cheerful today. She joined the music session. She sang along with the group. She also ate lunch with other residents. Her appetite was better than yesterday. She asked about your children. I told her you may call this evening. She smiled when she heard that. Please call before seven if possible. I will help her answer the phone.",
        "Good afternoon, I am updating you about Mr Wong. He has a doctor's appointment tomorrow. Transport has already been arranged. We packed his documents and medication list. A staff member will accompany him. The appointment is at ten o'clock. We expect to return before lunch. We will inform you of the result. Please send any questions you want us to ask. We will include them in the notes.",
        "Hello, your mother refused lunch today. She said she did not feel hungry. We offered soup and fruit instead. She ate a small amount later. Her mood seemed quiet. The nurse checked on her. There were no urgent concerns. We will continue to encourage meals. You may call her this evening. Your voice may help comfort her.",
        "Hi, I am calling from the care facility. Your father needs more comfortable shoes. The physiotherapist noticed his shoes are loose. This may increase the risk of falling. Please bring a safer pair when you visit. Shoes with good grip are preferred. We can label them with his name. He is otherwise doing well. He completed his exercise today. Thank you for your support.",
        "Hello, your aunt received your parcel today. She was very happy to open it. The cardigan fits her well. She asked me to thank you. She wore it during the afternoon tea. Several residents complimented the colour. She seemed more relaxed after that. She also kept the card beside her bed. I will remind her to call you tomorrow. Please let us know if you send anything else.",
        "Good evening, I want to discuss the care plan. Your mother has been sleeping more during the day. This affects her night routine. We are encouraging more daytime activity. She enjoys light exercise and music. Would you support this plan? The doctor will also review her medication. We want to improve her sleep pattern. Your input is important to us. Please reply when you are available.",
        "Hello, your father attended his wound review today. The nurse said the wound is improving. There is no sign of infection. The dressing will continue daily. He reported less pain. He was able to sit comfortably. We encouraged him not to scratch the area. He understood the instruction. We will keep monitoring the wound. I will update you again next week.",
        "Hi, your sister seemed anxious today. She asked many times about going home. We reassured her gently. She became calmer after lunch. She spent time in the garden. A staff member stayed with her. We will watch her mood closely. Please send a family photo if possible. It may help her feel settled. Thank you for working with us."
    ],

    "Resident-Family": [
        "Hello, my dear. I am happy to hear your voice. I slept better last night. The staff helped me with breakfast. I joined a small activity this morning. I missed you today. Can you visit me this weekend? Please bring the family photos. I want to see the children again. Take care and call me tomorrow.",
        "Hi, son. I went for a short walk today. The staff walked beside me. I felt tired but happy. My knee still hurts a little. The nurse gave me medicine. I ate soup for lunch. It tasted quite good. Please do not worry too much. I will rest early tonight.",
        "Hello, Mum. I received your card today. The message made me smile. I keep it near my bed. The room feels warmer now. The staff are kind to me. I still miss home sometimes. Can you call me after dinner? I want to tell you about my day. I love you very much.",
        "Hi, Anna. I watched the music show today. It reminded me of old songs. I sang with the other residents. The staff said I did well. I wish you were here. Maybe we can sing together next time. Please bring my blue scarf. The weather feels cold now. I hope to see you soon.",
        "Dear family. I am feeling better today. The doctor checked me this morning. They said I should drink more water. I will try to remember. Lunch was rice and vegetables. I ate slowly but finished most of it. I rested after lunch. Please visit when you are free. I miss everyone at home.",
        "Hello, daughter. I felt lonely this afternoon. The staff sat with me for a while. That helped me calm down. I looked at your photo again. It made me feel close to you. Can you bring more photos next time? I want one for my table. Please tell the children I love them. I hope they are studying well.",
        "Hi, brother. I remembered our old house today. We used to sit outside after dinner. That memory made me happy. The garden here is nice too. I walked there this morning. The flowers are beautiful. You should visit and see them. We can drink tea together. Please come when you have time.",
        "Hello, everyone. I had a quiet day. I did not feel very hungry. The staff gave me soup. I ate a little and felt better. I slept for one hour after lunch. The nurse said I should rest more. Please do not worry. I will try to eat more tomorrow. Call me when you can.",
        "Hi, my dear grandson. Thank you for drawing the picture. I put it on my wall. It makes my room brighter. I showed it to the nurse. She said it was beautiful. I am proud of you. Study hard and be kind. I hope you visit soon. Grandma loves you.",
        "Hello, sweetheart. I had my hair cut today. The staff helped me choose the style. I feel fresh and comfortable. I wish you could see it. Maybe we can video call later. Please help me set up the phone. I want to see your face. Have a good day at work. I love you."
    ],

    "Staff-Staff": [
        "I finished the morning round. Room 204 still needs medication. Mrs Tan refused breakfast. Please check on her again later. Mr Lee has a doctor review at ten. His documents are ready. The transport will arrive at nine thirty. I updated the care notes. Please remind the nurse about the wound dressing. I will take my break after handover.",
        "Can you help me with room 108? Mr Wong needs assistance moving to the chair. He is weaker than usual today. Please use the walking frame. The physiotherapist will come after lunch. His daughter may visit at three. The room has been cleaned. His water bottle needs refilling. I will prepare his medication chart. Let me know when he is settled.",
        "The afternoon activity starts at two. Please bring residents from the west wing. Mrs Green wants to join today. Mr Brown may need encouragement. The activity room is already prepared. There are enough chairs for everyone. Snacks will arrive at two thirty. Please record attendance in the system. I will take photos for the family update. Make sure consent is checked first.",
        "The night shift report is ready. Mrs Chen slept poorly last night. She used the call bell three times. Mr Ahmad's wound dressing remained dry. Room 112 needs extra towels. The kitchen delivered breakfast labels. Medication trolley one has been restocked. Please check fridge temperature before handover. The doctor will visit at eight thirty. I will stay until the handover is complete.",
        "I uploaded today's notes to the system. Please review the entries for room 206. There may be one missing observation. The blood pressure reading was written on paper. I left the paper at the nurse station. Can you enter it before the audit? The manager asked for updates by five. The family call summary is complete. Only the meal record is pending. Thank you for checking it.",
        "We need to prepare for the family meeting. The meeting is at three o'clock. Mrs Davis's daughter will attend online. The doctor may join for ten minutes. Please print the latest care plan. I will prepare the medication summary. The resident wants to discuss sleep issues. We should also mention her appetite. The meeting room is booked. Please bring a laptop for the video call.",
        "The laundry delivery arrived this morning. Some clothes are not labelled. Please check with the residents before putting them away. Mrs Lim is missing a blue cardigan. It may be in the shared laundry basket. I will ask the evening staff to look again. The clean towels are in the storage room. Room 105 needs new bed sheets. Please update the task list after finishing. I will help after medication round.",
        "The new resident arrives tomorrow. His room should be ready by noon. Please check the bed and call bell. The welcome pack is on the desk. The family will bring his clothes. The nurse will complete the admission assessment. We need to prepare the dietary form. He prefers soft food. The manager asked us to greet the family. I will update the roster.",
        "There was a small spill near the dining room. I placed a warning sign there. Please ask cleaning staff to mop it. Residents should avoid that area for now. Mr Brown almost slipped earlier. He was not injured. I reported the incident in the system. The supervisor has been informed. Please remove the sign after the floor dries. I will check the area again later.",
        "Can you cover my break at one o'clock? I need to call the pharmacy. One prescription is still missing. The delivery should arrive this afternoon. Please watch room 210 during that time. The resident may press the call bell. She needs assistance to the bathroom. I will return within twenty minutes. I have already completed her lunch record. Thank you for helping me."
    ],

    "General Daily Communication": [
        "Hello, are you free this afternoon? I need help with my appointment. The clinic is near the train station. I am not sure which bus to take. Can you come with me? The appointment starts at two o'clock. We should leave before one thirty. I will bring the documents. Please remind me to take my card. Thank you for helping me.",
        "Hi, I am going to the supermarket. Do you need anything? I can buy milk and bread. We also need eggs. Please check if there is enough rice. I will leave in ten minutes. Send me a message if you remember something. I may come back before dinner. Do not forget to lock the door. See you later.",
        "Good morning. The weather looks cloudy today. You should bring an umbrella. The bus may be late because of rain. I will check the timetable. Please wear a jacket. It may become colder tonight. We can meet at the station. Call me when you arrive. I will wait near the entrance.",
        "Hello, I cannot attend class today. I am feeling unwell. I will email the tutor. Can you share the notes with me? I will review them tonight. Please tell me if there is homework. I do not want to miss the deadline. The group meeting is still tomorrow. I can join online if needed. Thank you for understanding.",
        "Hi, the internet is not working. I restarted the router already. The light is still red. Can you check the cable? I need to submit my assignment tonight. Maybe we should contact support. I will use mobile data for now. Please do not stream videos. The connection is very slow. I hope it works again soon.",
        "Good evening. Dinner is almost ready. Please wash your hands. The rice is on the table. The soup is still hot. Can you bring the plates? I will turn off the stove. After dinner, we can clean together. Please put leftovers in the fridge. Thank you for helping.",
        "Hi, I am running late. The train was delayed. I may arrive in twenty minutes. Please order first if you are hungry. I am sorry for making you wait. I will message you when I get closer. The restaurant is near the station. Can you save me a seat? I will come as fast as I can. Thank you for waiting.",
        "Hello, can you help me carry this box? It is heavier than I expected. We need to move it upstairs. Please hold the bottom carefully. Do not lift too quickly. We can take a break halfway. The room is on the second floor. After that, we can move the smaller bags. I really appreciate your help. Let us start when you are ready.",
        "Hi, I forgot my password. I cannot log in to the website. I tried resetting it twice. The email has not arrived. Can you check the spam folder? Maybe I typed the address wrong. I need access before tomorrow. I will contact support if it still fails. Please let me know if you find the email. Thank you.",
        "Good afternoon. We should plan the weekend trip. The weather may be sunny. We can leave early on Saturday. Please check the train schedule. I will prepare some snacks. We should bring water as well. The walk may take two hours. Comfortable shoes are important. Let us confirm the plan tonight."
    ]
}


prefix_map = {
    "Staff-Resident": "SR",
    "Staff-Doctor": "SD",
    "Staff-Family": "SF",
    "Resident-Family": "RF",
    "Staff-Staff": "SS",
    "General Daily Communication": "GD"
}


def split_sentences(text):
    # Simple splitter suitable for this controlled dataset.
    sentences = []
    current = ""
    for char in text:
        current += char
        if char in ".?":
            sentence = current.strip()
            if sentence:
                sentences.append(sentence)
            current = ""
    if current.strip():
        sentences.append(current.strip())
    return sentences


def clean_word(word):
    return word.lower().replace(",", "").replace(".", "").replace("?", "").replace("'", "")


def missing_words_noise(output):
    sentences = split_sentences(output)
    noisy = []

    for i, sentence in enumerate(sentences):
        words = [clean_word(w) for w in sentence.split()]
        words = [w for w in words if w]

        remove_words = {
            "is", "are", "am", "the", "a", "an", "to", "for", "with",
            "will", "would", "can", "should", "please", "your", "you",
            "do", "did", "have", "has", "had", "this", "that", "it"
        }

        kept = [w for w in words if w not in remove_words]

        # Keep it realistic: not too empty.
        if len(kept) < 3:
            kept = words[:4]

        noisy.append(" ".join(kept))

    return ". ".join(noisy) + "."


def broken_grammar_noise(output):
    sentences = split_sentences(output)
    noisy = []

    replacements = {
        "i am": "i",
        "i will": "i",
        "you are": "you",
        "are you": "you",
        "do you": "you",
        "did you": "you",
        "would you": "you",
        "can you": "you can",
        "he is": "he",
        "she is": "she",
        "it is": "it",
        "they are": "they",
        "we will": "we",
        "we are": "we",
        "has been": "have been",
        "have been": "has been",
        "did not": "not",
        "does not": "not",
        "do not": "not",
        "was": "is",
        "were": "is",
        "ate": "eat",
        "slept": "sleep",
        "went": "go",
        "took": "take",
        "checked": "check",
        "helped": "help",
        "called": "call",
        "visited": "visit",
        "reported": "report",
        "refused": "refuse",
        "arrived": "arrive",
        "finished": "finish",
        "brushed": "brush",
        "packed": "pack",
        "asked": "ask",
        "looked": "look",
        "started": "start",
        "applied": "apply"
    }

    for sentence in sentences:
        s = sentence.lower().replace(",", "").replace("?", ".")
        for correct, noisy_phrase in replacements.items():
            s = s.replace(correct, noisy_phrase)
        s = s.replace("  ", " ").strip()
        noisy.append(s)

    return " ".join(noisy)


def no_punctuation_noise(output):
    text = output.lower()
    for mark in [".", ",", "?", "!", ":", ";", "'", '"']:
        text = text.replace(mark, "")
    return " ".join(text.split())


def word_order_repetition_noise(output):
    sentences = split_sentences(output)
    noisy = []

    for i, sentence in enumerate(sentences):
        words = [clean_word(w) for w in sentence.split()]
        words = [w for w in words if w]

        if len(words) >= 6:
            # More human-like: move time/object words forward and repeat one natural word.
            first_part = words[2:5]
            second_part = words[:2]
            rest = words[5:]
            repeated = first_part[:]
            if len(repeated) >= 2:
                repeated.insert(1, repeated[1])
            new_words = repeated + second_part + rest
        elif len(words) >= 4:
            new_words = [words[1], words[0], words[1]] + words[2:]
        else:
            new_words = words + words[-1:]

        noisy.append(" ".join(new_words))

    return ". ".join(noisy) + "."


noise_functions = [
    ("missing_words", missing_words_noise),
    ("broken_grammar", broken_grammar_noise),
    ("no_punctuation", no_punctuation_noise),
    ("word_order_repetition", word_order_repetition_noise)
]


def build_dataset():
    dataset = []

    for category, conversations in clean_conversations.items():
        prefix = prefix_map[category]

        for conversation_number, output in enumerate(conversations, start=1):
            conversation_id = f"{prefix}_{conversation_number:02d}"

            for variation_number, (noise_type, noise_function) in enumerate(noise_functions, start=1):
                dataset.append({
                    "category": category,
                    "conversation_id": conversation_id,
                    "variation": variation_number,
                    "noise_type": noise_type,
                    "input": noise_function(output),
                    "output": output
                })

    return dataset


dataset = build_dataset()


def validate_dataset():
    expected_pairs = 6 * 10 * 4

    if len(dataset) != expected_pairs:
        raise ValueError(f"Dataset should contain {expected_pairs} pairs, but found {len(dataset)}.")

    grouped = {}

    for item in dataset:
        key = (item["category"], item["conversation_id"])
        grouped.setdefault(key, []).append(item)

    if len(grouped) != 60:
        raise ValueError(f"Dataset should contain 60 clean conversations, but found {len(grouped)}.")

    for key, items in grouped.items():
        if len(items) != 4:
            raise ValueError(f"{key} should have 4 duplicated variations, but found {len(items)}.")

        outputs = {item["output"] for item in items}
        if len(outputs) != 1:
            raise ValueError(f"{key} has different outputs. Output must stay unchanged.")

        noise_types = {item["noise_type"] for item in items}
        if noise_types != {"missing_words", "broken_grammar", "no_punctuation", "word_order_repetition"}:
            raise ValueError(f"{key} does not contain the required 4 noise types.")

        sentence_count = len(split_sentences(items[0]["output"]))
        if sentence_count < 10 or sentence_count > 15:
            raise ValueError(f"{key} output should have 10-15 sentences, but has {sentence_count}.")

    return True


if __name__ == "__main__":
    validate_dataset()

    print("Dataset validation passed.")
    print("Total categories:", len(clean_conversations))
    print("Total clean conversations:", 60)
    print("Total input-output pairs:", len(dataset))

    with open("sr_dataset_human_noise.json", "w", encoding="utf-8") as file:
        json.dump(dataset, file, indent=2, ensure_ascii=False)

    print("Saved JSON file: sr_dataset_human_noise.json")
