# Synapse

## Project Overview
Synapse is a real-time collaborative platform designed as a web application to enable seamless synchronization and instant resource exchange within any group environment. It simplifies coordination by allowing users to create instant, temporary groups for sharing information the moment it is needed. 

Unlike traditional file-sharing platforms that require a slow 'upload-then-share-link' workflow and rely on third-party cloud storage, Synapse provides a lightweight solution for ad-hoc collaboration. The system is strictly ephemeral; it acts as a live workspace where all data is wiped upon session termination, ensuring no persistent digital footprint remains.

## Tech Stack & Usage
* **Frontend (React.js & Vite):** The client interface is built with React.js and Stomp.js. It handles the Binary Streaming Engine, fragmenting files into 16KB chunks, encoding them as Base64 strings, and reassembling them as Blob objects directly in the browser to bypass RAM limits.
* **Backend (Java 17 & Spring Boot 3.x):** The core server infrastructure uses Spring Messaging (STOMP/SockJS) to operate as a P2P-inspired WebSocket relay. It avoids database I/O entirely by managing state through an in-memory `ConcurrentHashMap`.
* **Security:** Initial HTTP handshakes require JWT (JSON Web Tokens) validation before upgrading to a WebSocket connection, paired with temporary 6-digit access codes for room entry. 
* **Development Environment:** The project is optimized to run efficiently on standard developer hardware, utilizing an Intel i3 11th Gen processor and 8GB RAM for local WebSocket buffer memory.

## Project Links
* **Live Deployment:** [mini-project-hcl.vercel.app](https://mini-project-hcl.vercel.app)
* **Repository:** [GitHub - notashock/mini-project-hcl](https://github.com/notashock/mini-project-hcl)

## How the Application Works
1.  **Session Initialization:** A host initiates a session via a REST POST request (`/create`), generating a unique session ID and a 6-digit join code. Participants join using this code, completing a secure handshake.
2.  **Real-Time Connection:** Upon validation, the system establishes a WebSocket connection using STOMP over SockJS. This enables instant live chat and join/leave presence tracking via a Pub/Sub model without HTTP polling latency.
3.  **Direct File Streaming:** When a user shares a file, it bypasses third-party storage. The client fragments the binary data and streams it through the WebSocket broker on the `/topic/session/{id}/file-stream` channel directly to connected clients.
4.  **Bandwidth Optimization:** A custom `ChannelInterceptor` (preSend) on the backend caches the sender's socket ID. Before broadcasting a file chunk, it compares the sender and recipient IDs; if they match, the packet is dropped. This "Sender-Bypass" eliminates echo loops, drastically reducing server load and bandwidth waste.
5.  **Session Termination:** Once the host ends the session, the ephemeral logic instantly clears the `ConcurrentHashMap` memory references, permanently wiping the chat history and file streams.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
