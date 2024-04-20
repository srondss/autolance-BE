import express, { json } from "express";

import { OpenAI } from "openai";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

const app = express();
const port = process.env.PORT || 3000;
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const openai = new OpenAI({
    organization: process.env.OPENAI_ORG_ID,
    project: process.env.OPENAI_PROJECT_ID,
    apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(json()); // for parsing application/json
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.split(" ")[1]; // Assuming "Bearer TOKEN"

    if (!token) {
        return res
            .status(401)
            .json({ error: "Authentication token is required" });
    }

    try {
        const { data: user, error } = await supabase.auth.getUser(token);

        if (error) {
            throw error;
        }

        req.user = user.user;
        next();
    } catch (error) {
        return res
            .status(403)
            .json({ error: "Invalid token or user not found" });
    }
};

app.get("/", (req, res) => {
    res.send("Hello World! This is the ChatGPT Clone Backend.");
});

// AUTH ROUTES
app.post("/auth/signup", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Invalid request" });
    }

    try {
        const { error } = await supabase.auth.signUp({
            email: email,
            password: password,
        });

        if (error) {
            throw error.message;
        }

        res.send("User signed up successfully!");
    } catch (error) {
        console.error("Error in signup:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Invalid request" });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.log("Throwing Error...");
            throw error;
        }

        res.json({ accessToken: data.session.access_token });
    } catch (error) {
        if (error.message) {
            return res.status(500).json({ error: error.message });
        }
    }
});

app.post("/auth/logout", authenticateUser, async (req, res) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.split(" ")[1]; // Assuming "Bearer TOKEN"

    try {
        const { error } = await supabase.auth.signOut(token);

        if (error) {
            throw error;
        }

        res.send("User logged out successfully!");
    } catch (error) {
        console.error("Error in logout:", error);
        res.status(500).json({ error: error });
    }
});

// CHAT ROUTES
app.post("/chat/new", authenticateUser, async (req, res) => {
    const { messageToSend, from } = req.body;

    if (!messageToSend || !from) {
        return res.status(400).json({ error: "Invalid request" });
    }

    try {
        // Create a new conversation
        const { data: conversation, error: conversationError } = await supabase
            .from("Conversations")
            .insert([{ user_id: req.user.id, summary: messageToSend }])
            .select();

        if (conversationError) {
            throw conversationError;
        }

        const conversationResponse = conversation;

        // Send the message
        const { data: message, error: messageError } = await supabase
            .from("Messages")
            .insert([
                {
                    conversation_id: conversationResponse[0].conversation_id,
                    from: from,
                    message: messageToSend,
                },
            ])
            .select();

        if (messageError) {
            throw messageError;
        }

        const messageResponse = message;
        res.json(messageResponse[0]);
    } catch (error) {
        console.error("Error in creating new chat:", error);
        res.status(500).json({ error: "Failed to create new chat" });
    }
});

app.post("/chat/:conversationId", authenticateUser, async (req, res) => {
    const { messageToSend, conversationId, from, chatHistory } = req.body;

    console.log("Received:", messageToSend, conversationId, from);

    if (
        (!messageToSend && from === "user") ||
        !conversationId ||
        !from ||
        (!chatHistory && from === "assistant")
    ) {
        return res.status(400).json({ error: "Invalid request" });
    }

    try {
        if (from === "user") {
            const { data: message, error: messageError } = await supabase
                .from("Messages")
                .insert([
                    {
                        conversation_id: conversationId,
                        from: from,
                        message: messageToSend,
                    },
                ])
                .select();

            if (messageError) {
                throw messageError;
            }

            const messageResponse = message;
            console.log("Message Response:", messageResponse[0]);
            res.status(200).json(messageResponse[0]);
        } else {
            // Assistant

            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo-0125",
                messages: chatHistory,
            });

            const { data: message, error: messageError } = await supabase
                .from("Messages")
                .insert([
                    {
                        conversation_id: conversationId,
                        from: from,
                        message: response.choices[0].message.content,
                    },
                ])
                .select();

            if (messageError) {
                throw messageError;
            }

            const messageResponse = message;

            console.log("Message Response:", messageResponse[0]);

            res.status(200).json(messageResponse[0]);
        }
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});

// FETCH CHATS
app.get("/chat/conversations", authenticateUser, async (req, res) => {
    try {
        console.log("User ID:", req.user.id);

        const { data: conversations, error } = await supabase
            .from("Conversations")
            .select("conversation_id, summary")
            .eq("user_id", req.user.id);

        console.log("Conversations:", conversations);

        if (error) {
            throw error;
        }

        res.json(conversations);
    } catch (error) {
        console.error("Error fetching conversations:", error);
        res.status(500).json({ error: "Failed to fetch conversations" });
    }
});

app.get("/chat/:conversationId", authenticateUser, async (req, res) => {
    const conversationId = req.params.conversationId;

    try {
        const { data: messages, error } = await supabase
            .from("Messages")
            .select("*")
            .eq("conversation_id", conversationId);

        if (error) {
            throw error;
        }

        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
