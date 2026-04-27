Introduction
Welcome to the home of Fonoster’s documentation.

​
What is Fonoster?
Fonoster is an innovative Programmable Telecommunications Stack that allows businesses to connect telephony services with the Internet entirely through a cloud-based utility.
The most notable features of Fonoster are:
Multitenancy
Easy deployment of PBX functionalities
Programmable Voice Applications
NodeSDK and WebSDK
Support for Amazon Simple Storage Service (S3)
Secure API endpoints with Let’s Encrypt
Authentication with OAuth2
Authentication with JWT
Role-Based Access Control (RBAC)
Plugins-based Command-line Tool
Support for Speech APIs from Google, Deepgram, ElevenLabs, and more
We’re open source, and you can use the Fonoster Cloud (Coming soon) or Self-host Fonoster on your infrastructure.
​
What can you build?
With Fonoster, you can build any type of voice application, from simple IVRs to advanced Voice AI. Check out a demo below for a glance at what you can make.
Quickstart
Learn how to get started with Fonoster.

Most of Fonoster’s use cases require an account, the Command-line interface, and a virtual phone number. This guide will walk you through the steps to start with Fonoster quickly.
1
Request early access

To get started, you’ll need a Fonoster account. Sign up at https://app.fonoster.com/auth/signup
2
Create a simple voice application

Voice applications in Fonoster require Node.js to run. If you don’t have Node.js installed, you can download it from the official website
. Once you have Node.js installed, you can create a simple voice application by running the following commands:
mkdir voice-app
cd voice-app
npm init -y
npm install @fonoster/voice
Create a new script and add the following code:
index.js
  const VoiceServer = require("@fonoster/voice").default;

  new VoiceServer().listen(async (req, voice) => {
    await voice.answer();
    await voice.say("Hello from Fonoster!");
    await voice.hangup();
  });
Finally, run the application with the following command:
node index.js
Keep the application running for the next steps.
3
Publish your application

To make your application available to the public, you must expose it to the internet. One way to do this is by using a service like ngrok
. You can install ngrok by running the following command:
npm install -g ngrok
Once you have ngrok installed, you can expose your application by running the following command:
ngrok tcp 50061
Your output should look like this:

This will give you a public endpoint that you can use to access your application.
4
Link a virtual phone number

Follow the next steps to link a virtual phone number to your application:
Install the command-line tool

Fonoster CTL is a command-line tool that allows you to manage your Fonoster resources. You can create, update, and delete Fonoster resources like phone numbers, SIP trunks, etc.
You can install the tool using the following command:
npm install -g @fonoster/ctl
Check that the installation was successful by running the following command:
fonoster --version
If the installation was successful, you should see the version number of the command-line tool.
Log in to a Fonoster Workspace

Before using the command-line tool, log in to a Workspace. You can do this by running the following command:
fonoster workspaces:login
This command will prompt you to enter your AccessKeyId and AccessKeySecret. Once you have entered this information, you will be logged in to your Workspace.
Create a new Application

To create a new Application, you can use the following command:
fonoster applications:create
You will be asked to enter the Application’s name, speech information, and other details. Once you have entered this information, the Application will be created.
Your output should look like this:

To can list your existing applications with the following command:
fonoster applications:list
Link a Twilio phone number

To link a Twilio phone number to your application, you can use the following command:
fonoster sipnet:numbers:linkTwilioNumber
You will be asked to enter an existing virtual phone number, the Twilio SID, and the Twilio Auth Token. Once you have entered this information, the Twilio phone number will be linked to your application.
To confirm that the phone number was linked successfully, you can run the following command:
fonoster sipnet:numbers:list
You can now call the Twilio phone number to access your voice application.
Twilio is used as an example. You can use other SIP providers as well.
Make an outbound call

You can use the command-line tool or the SDK to make an outbound call. To make an outbound call, first, you need the reference of the application you created. You can get the reference by running the following command:
fonoster applications:list
Once you have the reference, you can use the fonoster sipnet:calls:create command to make an outbound call. Here is an example:
fonoster sipnet:calls:create --app-ref 4b01c9b1-8cb1-48fb-bd49-f3daf13463a9 \
 --from +18456134823 \
 --to +17853134923
You can also use the SDK to make an outbound call. To do this, you can use the following code:
call.js
const SDK = require("@fonoster/sdk");

# Replace with your Workspace Access Key Id
const client = SDK.Client({ accessKeyId: "00000000-0000-0000-0000-000000000000" });

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => {
    const calls = new SDK.Calls(client);

    const response = await calls.createCall({
      from: "+18456134823",
      to: "+17853134923",
      appRef: "4b01c9b1-8cb1-48fb-bd49-f3daf13463a9"
    })

    console.log(response);
  });
Replace the example values with the appropriate ones.
Now that you have created your first Application learn more about Fonoster’s advanced features and concepts.
Workspaces
Workspaces are a way to group related resources.

Workspaces in Fonoster allow you to organize and secure your resources. All resources within a Workspace are accessible to all members of the Workspace. Similarly, a set of API Keys created within a Workspace will have access to all resources in the Workspace according to the permissions granted to the API Key.
Once a Workspace is created, you can invite other users to join the Workspace and collaborate on resources.
​
Workspace resources
Within a Workspace, you will have the ability to create and manage the following resources:
Applications
Virtual Numbers
SIP Trunks
SIP Credentials
SIP Access Control Lists
SIP Domains and Agents
CDRs
API Keys
Secrets
Etc


Identity and tokens
Users, Workspaces, API Keys, and more.

This document provides a high-level overview of the Identity module, which is helpful for maintainers, contributors, and developers who want to understand its architecture and design or contribute to it.
The Identity service does not do much by itself. It is intended to be used within the context of Fonoster.
title
​
About Identity
The Fonoster Identity provides the cornerstone for secure user management, authentication, and authorization within the Fonoster Ecosystem. It is designed with flexibility and scalability to accommodate the diverse and evolving needs of the various Fonoster projects.
​
Key Features
This module offers comprehensive identity management functionality, including creating, reading, updating, and deleting user and workspace entities. Users may represent individual accounts or service accounts. Workspaces provide a way to organize users and streamline permission administration logically. A user can belong to multiple workspaces.
The Identity module ensures secure authentication by employing industry-standard JSON Web Tokens (JWTs). It supports a variety of authentication mechanisms, including username and password, Multi-Factor Authentication (MFA) for added security, OAuth2 for integration with external identity providers, and token exchange to accommodate diverse scenarios.
Authorization is implemented through a Role-Based Access Control (RBAC) model, allowing for granular control over user and service actions. Predefined roles offer convenience, while the option to create custom roles provides maximum flexibility.
​
Users, Workspaces, and Roles
Individual users or services connecting to the Identity service will require a Role. As you will see in the next section, a Role has a set of allowed actions.
Take the following example:
In the case of Fonoster, we might have the Owner, Admin, and Member as Roles associated with a Workspace. In such cases, the Owner will be able to perform all actions, the Admin will be allowed to perform all actions except removing the Workspace, and members will have the ability to make changes to specific resources but not be able to see billing information.
​
Resource Ownership
All resources created within Fonoster have an owner. The owner may be a user or a workspace. For example, a user may own a workspace, and a workspace can own applications, phone numbers, domains, etc.
Creating a resource within a workspace automatically marks it with the workspace’s identifier (the accessKeyId).
The accessKeyId for a user always starts with the prefix US, while the accessKeyId for a workspace starts with the prefix WO, which helps identify the resource owner type.
​
Role-Based Access Control
Fonoster Identity relies on Role-Based Access Control (RBAC) to offer granular control over parts of the system. The following type can describe the policy for RBAC within Fonoster Identity.
​
ID, Access, and Refresh Tokens
The Identity module employs JSON Web Tokens (JWTs) for secure and flexible authentication. It strategically utilizes three types of tokens: ID, access, and refresh. Each token type serves a distinct purpose in the authentication process.
ID tokens identify the user and contain information about their identity. Typically short-lived, issued upon successful authentication. The following is an example of an ID token:
tokenUse=id
{
  "iss": "https://identity-global.fonoster.com",
  "sub": "00000000-0000-0000-0000-000000000000",
  "aud": "api",
  "tokenUse": "id",
  "accessKeyId": "US00000000000000000000000000000000",
  "email": "johndoe@example.com",
  "emailVerified": true,
  "phoneNumber": null,
  "phoneNumberVerified": false,
  "iat": 1723477780,
  "exp": 1723478680
}
Access tokens enhance security with short lifespans (e.g., minutes to 15m). They contain claims about the user or service, represented as a JSON object. The following is an example of an access token:
tokenUse=access
{
  "iss": "https://identity-global.fonoster.com",
  "sub": "00000000-0000-0000-0000-000000000000",
  "aud": "api",
  "tokenUse": "access",
  "accessKeyId": "US00000000000000000000000000000000",
  "access": [
    {
      "accessKeyId": "WO00000000000000000000000000000000",
      "role": "OWNER"
    }
  ],
  "iat": 1723477780,
  "exp": 1723478680
}
Here, sub is the user identifier, aud is the intended audience, and access contains a list of workspaces and their associated roles.
Refresh tokens have the specific function of obtaining new access tokens upon expiry. They possess longer lifespans than access tokens, potentially spanning days, weeks, or months, minimizing the frequency with which users need to re-enter their credentials. Due to their extended validity, refresh tokens warrant secure storage and careful management.
By default, refresh tokens are issued with a 24-hour expiration time. You can adjust this value to suit your security requirements.
An example of a refresh token:
tokenUse=refresh
{
  "iss": "https://identity-global.fonoster.com",
  "sub": "00000000-0000-0000-0000-000000000000",
  "aud": "api",
  "tokenUse": "refresh",
  "accessKeyId": "US00000000000000000000000000000000",
  "iat": 1723477780,
  "exp": 1723564180
}
Like the access token, the sub is the user identifier, and the aud is the intended audience.
While you can manually exchange the refresh token, Fonoster provides automatic token exchange via SDKs.
​
Token Exchange
The Identity service supports a variety of mechanisms to obtain initial access and refresh tokens. A conventional method involves a user supplying their username and password in exchange for an access token and a refresh token.
The service can enforce Multi-Factor Authentication (MFA) for enhanced security, requiring users to provide their username, password, and a time-based MFA code. Upon successful authentication, the module issues an access token and a refresh token.
The Identity service also supports OAuth2 code exchange, enabling integration with external identity providers. In this scenario, a user authenticates with the third-party provider and receives an authorization code to exchange with the Identity module for an access and refresh token.
Fonoster Identity simplifies the renewal process for expired access tokens. Users present a valid refresh token to receive a new access and refresh token pair.
If your authentication strategy includes API keys, the module can also facilitate exchanging them for tokens.
​
Refresh-Token
Fonoster Identity uses a time-based refresh token, which means a refresh token will expire after a fixed amount of time. The Identity service also provides a mechanism to invalidate existing refresh tokens to address scenarios like compromised devices or accounts.
​
Token Verification
The Identity module employs the RS256 algorithm to sign JWTs, guaranteeing their authenticity and integrity. A system can retrieve the public key from the issuer’s fonoster.identity.v1beta2.Identity.GetPublicKey gRPC endpoint and use it to validate a token.
The verification process involves two steps: first, confirming the token’s signature using the correct private key, and second, validating claims such as the issuer, intended audience, and expiration time to establish the token’s overall validity.
​
Security Practices
To uphold security standards, Fonoster Identity mandates using HTTPS in all communications to safeguard tokens during transmission. We apply the principle of least privilege by granting tokens only the minimum permissions necessary to perform a specific task. We maintain comprehensive logging and monitoring of authentication events, token activities, and potential anomalies, which are essential for security auditing and swift incident response.

API Keys
API keys are used to authenticate requests to the API.

API keys are used to authenticate requests to the API. API keys operate at the Workspace level and are used to authenticate requests to the API. You can create multiple API keys for a single Workspace, and each API key can be given different permissions.
All API keys have an Access Key ID and an Access Key Secret. The Access Key ID is used to identify the API key, and the Access Key Secret is used to authenticate the request. You should keep the Access Key Secret secure and never share it with anyone.
You can differentiate API keys’ Access Key ID from Workspace’s Access Key ID by the prefix “AP”.
Workspace’s Access Key ID have the “WO” prefix, and User’s Access Key ID has the “US” prefix
To create an API key with the SDK, first create a new Node.js project and install the SDK:
mkdir create-apikey
cd create-apikey
npm init -y
npm install @fonoster/sdk
Then, create a new file called index.js and add the following code:
const SDK = require("@fonoster/sdk");

// Replace with your Workspace's Access Key ID
const client = new SDK.Client({ accessKeyId: "WO00000000000000000000000000000000" });

// Use the username and password of your Fonoster account
client.login("you@example.com", "yourpassword").then(async () => {
  const apikeys = new SDK.ApiKeys(client);

  apikeys.createApiKey({
    role: "WORKSPACE_ADMIN",
  }).then((result) => {
    console.log(result);
  });
});
Run the script with the following command:
node index.js
Remember to save the Access Key ID and Access Key Secret in a secure location. You will not be able to retrieve the Access Key Secret again.
SDKs
SDKs for the Browser and NodeJS environment.

Fonoster SDKs provide you with control of a set of Fonoster resources. We currently offer SDKs for the Node.js and browser environment, and we plan to add more in the future.
​
Installation
$ npm install --save @fonoster/sdk
Or using yarn:
$ yarn add @fonoster/sdk
Or in the browser:
<script src="https://unpkg.com/@fonoster/sdk"></script>
​
Importing the library
For CommonJS projects:
const SDK = require("@fonoster/sdk");
For ES6 modules:
import * as SDK from "@fonoster/sdk";
Directly in the browser:
<script src="https://unpkg.com/@fonoster/sdk"></script>
<script>
   // You can now use the SDK
</script>
​
Example
Create a new SDK instance to interact with the Fonoster API. The SDK requires a client object to handle communication with the API.
​
Creating a client object
In Node.js:
const SDK = require("@fonoster/sdk");

# Replace with your Workspace's Access Key Id
const client = new SDK.Client({ accessKeyId: "WO00000000000000000000000000000000" });
When connecting to Fonoster’s cloud services, you can omit the endpoint parameter.
In the browser:
const SDK = require("@fonoster/sdk");
const client = new SDK.WebClient({ accessKeyId: "WO00000000000000000000000000000000" });
Note the only difference is the name of the constructor.
​
Login in and make requests
client.login("youruser@example.com", "yourpassword")
  .then(() => new SDK.Applications(client).createApplication({
    name: "MyApp",
    type: "EXTERNAL",
    endpoint: "welcome.demo.fonoster.local" // Demo application
  }))
  .then(() => console.log("Application created successfully"))
  .catch(console.error);
In addition to the login method, the SDK provides a loginWithApiKey and loginWithRefreshToken methods. The loginWithRefreshToken is helpful in browser environments where you want to keep the user logged in between sessions.

Programmable Voice
Verb-based voice call control in Fonoster.

Programmable Voice in Fonoster allows you to control the flow of a phone call using a set of verbs. Verbs work in conjunction with the VoiceServer to create a voice application.
​
Overview
The following is an example of how to create an application in Fonoster using the SDK:
create-app.js
const SDK = require("@fonoster/sdk");

const client = new SDK.Client({ accessKeyId: "WO000000000000000000000000000000" });

const appConfig = {
  name: "Custom Voice App",
  type: "EXTERNAL",
  endpoint: "welcome.demo.fonoster.local", // Built-in demo application
  speechToText: {
    productRef: "stt.deepgram",
    config: {
      languageCode: "en-US"
    }
  },
  textToSpeech: {
    productRef: "tts.deepgram",
    config: {
      voice: "aura-asteria-en"
    }
  }
}

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => new SDK.Applications(client).createApplication(appConfig))
  .catch(console.error);
In the example above, we created a new voice application using the SDK. The application is configured to use Deepgram for speech-to-text and text-to-speech. The application is also configured to use the “aura-asteria-en” voice for text-to-speech.
However, so far, we have only told Fonoster the speech configuration and the location of the application represented by the endpoint property.
You also need to run a VoiceServer using your application’s logic.
​
The Voice Server
The VoiceServer works similarly to an Express server. It accepts requests and returns responses. The VoiceServer processes verbs and executes the desired actions.
An example of running a VoiceServer in Fonoster:
voice-server.js
const VoiceServer = require("@fonoster/voice").default;

new VoiceServer().listen(async (req, response) => {
  // Verbs go here
  await response.answer();
  await response.say("Hello World!");
  await response.hangup();
});
Like with Express, you can use the request object to access information about the call. For example, you can access the caller’s phone number with req.callerNumber.
​
Verbs
Verbs are the building blocks of a voice application. They are used to control the flow of a phone call. Verbs are executed in the order they are called.
Here is a list of the available verbs in Fonoster:
Answer - Accepts an incoming call
Hangup - Closes the call
Play - Takes a URL with a media file and streams the sound back to the calling party
PlayDtmf - Takes a DTMF sequence and plays it back to the calling party
Say - Takes a text, synthesizes the text into audio, and streams back the result
Gather - Waits for DTMF or speech events and returns back the result
SGather - Returns a stream for future DTMF and speech results
Stream - Creates a bidirectional stream to send and receive audio from a caller
Dial - Passes the call to an Agent or a Number at the PSTN
Record - It records the voice of the calling party and saves the audio on the Storage sub-system
Mute - It tells the channel to stop sending media, effectively muting the channel
Unmute - It tells the channel to allow media flow
Run any setup code before calling the Answer verb. The Answer verb should be the first verb in your application. Similarly, the Hangup verb should be the last in your application.
​
Speech settings
Programmable Voice applications support a variety of speech-to-text and text-to-speech vendors. The speechToText and textToSpeech objects allow you to define the speech-to-text and text-to-speech engines to use.
You can mix and match vendors to suit your needs. For example, you can use Deepgram for speech-to-text and Google for text-to-speech. Please check the Speech Vendors section for more information on configuring speech-to-text and text-to-speech.
​
Exposing the VoiceServer with Ngrok
During development, you can use Ngrok to expose your VoiceServer to the internet. Ngrok creates a secure tunnel to your local machine. This allows you to test your voice application without deploying it to a server.
To use Ngrok, install it on your machine and run the following command:
ngrok tcp 50061
Replace 50061 with the port your VoiceServer is running on. Ngrok will provide you with a URL that you can use to access your VoiceServer.

Autopilot
Voice applications powered by LLMs.

The Autopilot is currently in overview mode and the KnowledgeBase features have been disabled.
Fonoster’s Autopilot is a component within the platform that allows you to create powerful conversational experiences. It is built on top of Fonoster Programmable Voice and uses the latest advances in Large Language Models (LLMs) to provide a natural and engaging experience.
​
Overview
The following is an example of creating an Autopilot application using the SDK.
First, add the following content to a file named appConfig.yaml:
appConfig.yaml
name: "Awesome Autopilot"
type: "AUTOPILOT"
speechToText:
  productRef: "stt.deepgram"
  config:
    model: "nova-3"
    languageCode: "en-US"
textToSpeech:
  productRef: "tts.deepgram"
  config:
    voice: "aura-asteria-en"
intelligence:
  productRef: "llm.groq"
  config:
    conversationSettings:
      firstMessage: "Hello, I'm your AI assitant."
      systemPrompt: |
        You are a Customer Service Representative. You are here to help the caller with their needs.
      goodbyeMessage: "Thank you so much, bye!"
      systemErrorMessage: "I'm sorry, I didn't understand that. Can you please repeat it?"
      idleOptions:
        message: "Are you still there?"
    languageModel:
      provider: "groq"
      model: "llama-3.3-70b-versatile"
      maxTokens: 240
      temperature: 0.4
Then, create the application as follows:
fonoster applications:create --from-file appConfig.yaml
Similarly, to update the application, you can use the applications:update command with the from-file flag.
​
General configuration
The Autopilot configuration is divided into a general section and three sub-sections: speechToText, textToSpeech, and intelligence.
The general section contains name, type, and endpoint properties.
The name property is the name of the Autopilot application. The type property is the type of the application, which should always be set to AUTOPILOT. The endpoint is an optional property allowing you to specify the endpoint for self-hosted Autopilots.
​
Speech settings
Autopilot applications support a variety of speech-to-text and text-to-speech vendors. The speechToText and textToSpeech objects allow you to define the speech-to-text and text-to-speech engines to use.
You can mix and match vendors to suit your needs. For example, you can use Deepgram for speech-to-text and Google for text-to-speech. Please check the Speech Vendors section for more information on configuring speech-to-text and text-to-speech.
​
Conversational settings
The conversationSettings object allows you to define the Autopilot’s conversational behavior. The conversation settings are independent of the language model used.
The following is a list of the supported settings:
Setting	Description	Default Value
firstMessage	The first message the Autopilot will say when the conversation starts
systemPrompt	A prompt that describes the behavior of the Autopilot and sets the context of the conversation
systemErrorMessage	The message the Autopilot will say when an error occurs
maxSessionDuration	Maximum length of the session (in milliseconds) before it is automatically terminated, regardless of activity	1800000 (30 minutes)
maxSpeechWaitTimeout	Specifies the maximum amount of time (in milliseconds) to wait for the user to begin speaking before sending the captured audio for processing	0
initialDtmf	A DTMF to play prior to starting the conversation
allowUserBargeIn	Determines whether the user can interrupt the voice agent while it is speaking	true
transferOptions	The options to transfer the call to a live agent
transferOptions.phoneNumber	The phone number to transfer the call to
transferOptions.message	The message to play before transferring the call
transferOptions.timeout	Time to wait for a transfer answer before the transfer attempt is considered failed	30000
idleOptions	The options to handle idle time during the conversation
idleOptions.message	The message to play after the idle time is reached
idleOptions.timeout	Duration of user inactivity (in milliseconds) before the system triggers an idle event	30000
idleOptions.maxTimeoutCount	The maximum number of times the idle message will be played before hanging up the call	2
vad	The voice activity detection settings
vad.activationThreshold	See VAD section	0.4
vad.deactivationThreshold	See VAD section	0.25
vad.debounceFrames	See VAD section	4
A few noteworthy settings include the maxSpeechWaitTimeout, initialDtmf, idleOptions, and vad.
​
Max Speech Wait Timeout
The maxSpeechWaitTimeout property allows you to specify the maximum time in milliseconds to wait for the caller before returning the speech-to-text result. If the caller does not speak within the specified time, the speech-to-text engine will return the result.
A value that is too low may result in the speech-to-text engine returning the result before the caller finishes speaking. A value that is too high may result in the speech-to-text engine waiting too long for the caller to speak.
​
Initial DTMF
Sometimes, users will use call forwarding to reach the number in Fonoster. Some telephony service providers require a Dual-tone multi-frequency (DTMF) to be played before connecting the call. The initialDtmf property allows you to specify a DTMF to play when the session starts.
​
Voice Activity Detection (VAD)
The vad object allows you to configure the voice activity detection settings. Voice activity detection is used to detect when the caller is speaking and when they are not speaking.
The vad object has the activationThreshold, deactivationThreshold, debounceFrames properties. The actionThreshold property is the activation threshold for voice activity detection. The deactivationThreshold property is the deactivation threshold for voice activity detection. The debounceFrames property is the number of frames to debounce the voice activity detection.
A lower activation threshold will make the detection more sensitive to the caller’s speech. A higher activation threshold will make detecting voice activity less sensitive to the caller’s speech.
A lower deactivation threshold will result in more aggressive voice activity detection deactivation. A higher deactivation threshold will result in less aggressive voice activity detection deactivation.
The debounceFrames parameter introduces a delay mechanism that ensures that transitions between “speech” and “non-speech” states are stable and not too sensitive to small fluctuations in the input audio signal. Here’s how it works:
By requiring multiple consecutive frames (debounceFrames) to confirm speech or non-speech, the system filters out short bursts of noise or brief gaps in speech that might otherwise cause erratic state changes.
​
Langue model configuration
The languageModel object allows you to define the language model the Autopilot uses. The language model is responsible for generating responses to the user’s input.
The following is a list of the supported settings:
Setting	Description
provider	Model provider
model	The model to use. The available models depend on the provider
maxTokens	The maximum number of tokens the language model can generate in a single response
temperature	The randomness of the language model. A higher temperature will result in more random responses
knowledgeBase	A list of knowledge bases to use for the language model
tools	A list of tools to use for the language model
​
LLM providers and models
The Autopilot supports multiple language model providers. The following is a list of the supported providers:
Provider	Description	Supported models
OpenAI	OpenAI provides various GPT models for conversational AI	gpt-4o, gpt-4o-mini, gpt-3.5-turbo, gpt-4-turbo
Groq	Groq offers high-performance AI models optimized for speed	llama-3.3-70b-versatile
Google	Google offers various LLM models for conversational AI	gemini-2.0-flash, gemini-2.0-flash-lite, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3-pro-preview, gemini-3-flash-preview
Anthropic	Anthropic offers various LLM models for conversational AI	Models temporarily unavailable
We have noticed that Groq models, particularly llama-3.3-70b-versatile, often require greater prompting specificity for effective tool usage. Also, Google’s gemini-2.0-flash-lite does not support tool calling. We will share best practices to ensure more consistent behavior as we gain more insights
​
Knowledge bases
Coming soon…
​
Tools
Fonoster’s Autopilot allows you to use tools to enhance the conversational experience. Tools are used to perform specific actions during the conversation.
​
Built-in tools
The following is a list of built-in tools available for an agent:
Tool	Description
hangup	A tool to end the conversation
transfer	A tool to transfer the call to a live agent
hold	A tool to put the call on hold (Coming soon)
​
Custom tools
You can add custom tools under intelligence.config.languageModel.tools, which is an array where each tool is defined as an object. These tools enable your assistant to interact with external services, APIs, or execute specific actions.
Each tool must follow the tool schema, for consistency and compatibility.
The following example demonstrates how to add a custom tool that fetches available appointment times for a specific date:
name: getAvailableTimes
description: Get available appointment times for a specific date.
requestStartMessage: "I'm looking for available appointment times for the date you provided."
parameters:
  type: object
  properties:
    date:
      type: string
      format: date // only 'enum' and 'date-time' are supported
  required:
    - date
operation:
  method: get
  url: https://api.example.com/appointment-times
  headers:
    x-api-key: your-api-key
The response from your endpoint must be a JSON object containing a result property. For example: { "result": "We have open slots for Thursday and Friday." }
​
Key Components of a Tool Definition:
name: A unique identifier for the tool
description: A brief explanation of what the tool does
requestStartMessage: The message sent when the tool is triggered
parameters: Defines the expected input structure in accordance with the JSON Schema standard, which is also required for OpenAI compatible tool calling
type: Defines the structure of the input (typically object)
properties: Specifies the fields expected in the input
required: Lists the fields that must be provided
operation:
method: The HTTP method (get and post are supported)
url: The endpoint to send the request to
headers: Any necessary headers, such as authentication keys
An important consideration when implementing your endpoints is that, when using the post method, the parameters will arrive in the body of the request, while with get, the parameters will arrive as query parameters.
For additional details, refer to the tool schema documentation.
Use operation.method post for POST requests. If don’t want the Autopilot to wait for POST requests to complete, set operation.waitForResponse to false. For get requests, the Autopilot will wait for the response by default.
​
Autopilot’s Test Cases
Test cases are an experimental feature and the behavior might change in the future.
The Autopilot supports automated testing through test cases defined in the configuration. Test cases allow you to verify the behavior of your Autopilot before deploying it to production.
The following is an example of creating a test case for Fonoster Autopilot:
testCases:
  evalsLanguageModel:
    provider: openai
    model: gpt-4o
    apiKey: sk-proj-REDACTED
  scenarios:
    - ref: test-case-1
      description: Test Case 1 Description
      telephonyContext:
        callDirection: FROM_PSTN
        ingressNumber: '+1234567890'
        callerNumber: '+1234567890'
      conversation:
        - userInput: 'Hi, can you tell me what''s in the menu?'
          expected:
            text:
              type: similar
              response: |
                We have a variety of sandwiches, salads, and drinks. Anything
                in particular you're looking for?
        - userInput: 'Nevermind, I want to speak to a human'
          expected:
            text:
              type: similar
              response: |
                I'll transfer you to a human representative. Please hold while I
                connect you.
            tools:
              - tool: transfer
                parameters: {}
​
Evaluation Language Model
The evalsLanguageModel section defines the model used to evaluate test cases:
Setting	Description
provider	Evaluation provider
model	The OpenAI model to use for evaluations
apiKey	The API key for the evaluation model
The evaluation model is separate from the model used in actual conversations. This separation allows for consistent evaluation results regardless of the production model being used.
​
Test Scenarios
Each test scenario represents a complete conversation flow. The scenario includes:
ref: A unique identifier for the test case
description: A brief description of what the test case verifies
telephonyContext: Emulates the context of a real phone call with the following properties:
callDirection: The direction of the call (e.g., “FROM_PSTN”)
ingressNumber: The number being called
callerNumber: The number making the call
This information is available to the AI model to help it understand the context of the call and might be use in your prompts.
​
Conversation Turns
Each scenario contains a series of conversation turns. A turn represents a single interaction between the user and the Autopilot, consisting of:
Component	Description
userInput	The text representing what the user says
expected	The expected response from the Autopilot
expected.text	The expected text response from the Autopilot
expected.text.type
expected.text.response	The actual text response from the Autopilot
expected.tools	The expected tools to be used in the response
expected.tools.tool	The name of the tool to be used
expected.tools.parameters
Use type: "similar" for text responses to allow for natural language variations in the Autopilot’s responses while maintaining the same semantic meaning.
The expected object can validate:
Text responses via the text property:
text:
  type: "similar"
  response: "Expected response..."
Tool usage via the tools property:
tools:
  - tool: "toolName"
    parameters:
      param1: "value1"
      param2: "valid-date" # Special keyword to test for a valid date

      Speech vendors
Speech-to-text and text-to-speech vendors in Fonoster.

Speech vendors in Fonoster provide speech-to-text and text-to-speech services for applications. Speech vendors are used to convert speech into text and text into speech.
​
Overview
Both AUTOPILOT and EXTERNAL applications use speech APIs. To illustrate the use of speech in Fonoster, look at the following example using the SDK:
const SDK = require("@fonoster/sdk");

const client = new SDK.Client({ accessKeyId: "WO000000000000000000000000000000" });

const appConfig = {
  name: "Custom Voice App",
  type: "EXTERNAL",
  endpoint: "welcome.demo.fonoster.local",
  speechToText: {
    productRef: "stt.deepgram",
    config: {
      languageCode: "en-US"
    }
  },
  textToSpeech: {
    productRef: "tts.deepgram",
    config: {
      voice: "aura-asteria-en"
    }
  }
}

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => new SDK.Applications(client).createApplication(appConfig))
  .catch(console.error);
In the example above, we create a new voice application using the SDK. The application is configured to use Deepgram for speech-to-text and text-to-speech. The application is also configured to use the “aura-asteria-en” voice for text-to-speech.
In Fonoster, you can mix and match speech vendors to suit your needs. For example, you can use Deepgram for speech-to-text and Google for text-to-speech.
​
Configuring speech-to-text
The speechToText object allows you to define the speech-to-text engine to use. The speech-to-text engine is responsible for converting the caller’s speech into text.
The speechToText object has the productRef and config properties. The productRef property identifies the speech-to-text vendor you want to use. The config property is an object that contains the configuration settings for the speech-to-text engine. The configuration settings vary depending on the vendor.
Currently, only Deepgram is supported as a speech-to-text vendor, but we are working on adding more vendors.
​
Deepgram configuration
Deepgram is a speech-to-text vendor that provides high-quality transcription services. Deepgram supports the languageCode as well as model properties. The languageCode property is the language code of the speech you want to transcribe. The model property is the model to use for transcription and defaults to nova-2-phonecall.
The Autopilot supports the models nova-2, nova-2-phonecall, and nova-2-conversationalai, nova-3.
Example of a Deepgram configuration for Spanish:
const appConfig = {
  ...
  speechToText: {
    productRef: "stt.deepgram",
    config: {
      model: "nova-2"
      languageCode: "es",
    }
  },
  ...
}
For languageCode other than en-US, you need to use the nova-2 model.
Please refer to the Deepgram documentation for more information.
​
Configuring text-to-speech
The textToSpeech object allows you to define the text-to-speech engine. The text-to-speech engine is responsible for converting the Autopilot’s responses into speech.
The textToSpeech object has the productRef and config properties. The productRef property identifies the text-to-speech vendor you want to use. The config property is an object that contains the configuration settings for the text-to-speech engine. The configuration settings vary depending on the vendor.
We currently support Google, Azure, Deepgram, and ElevenLabs as text-to-speech vendors.
Most vendors only support the voice property as the voice for the text-to-speech. The voice is a string that represents the voice to use. The available voices depend on the vendor.
Please visit the vendor’s documentation for more information on the available voices.
In addition to the voice property, the ElevenLabs vendor supports the model property. The model property is the model to use for text-to-speech and defaults to eleven_flash_v2_5. Please refer to the ElevenLabs documentation for additional information about the available models.
Example of a text-to-speech configuration for ElevenLabs:
const appConfig = {
  ...
  textToSpeech: {
    productRef: "tts.elevenlabs",
    config: {
      voice: "CaJslL1xziwefCeTNzHv",
      model: "eleven_flash_v2_5"
    }
  },
  ...
}
​
Available voices by vendor
The following links provide information on the available voices for each vendor:
Deepgram
ElevenLabs
Google
Azure

Bidirectional Streams
Bidirectional voice streaming in Fonoster.

Bidirectional streams are the foundation for modern Voice applications. They allow for more granular control over the audio stream, manipulating it in real time. In Fonoster, bidirectional streams are implemented on the Stream verb.
​
The Stream verb
The Stream verb lets you create a bidirectional stream to send and receive audio from a caller. Unlike other verbs in Fonoster, the Stream verb is asynchronous, meaning it does not block the execution of subsequent verbs in the script.
A common use case for the Stream verb is real-time transcription. In such scenarios, the Stream verb sends audio to a transcription service and receives the transcribed text.
​
Example using the Streams verb
Please see the highlighted lines for the most critical parts of the code.
voice-server.js
const VoiceServer = require("@fonoster/voice").default;
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

const deepgram = createClient("YOUR_DEEPGRAM_API_KEY");

async function handler(request, response) {
  await response.answer();

  const stream = await response.stream({ direction: "OUT" });

  const connection = deepgram.listen.live({
    model: "nova-2-phonecall",
    language: "en-US",
    encoding: "linear16",
    sample_rate: 16000
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data?.channel?.alternatives[0]?.transcript;
    if (transcript && data.speech_final) {
      console.log("Transcription:", transcript);
    }
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    stream.onPayload(payload => connection.send(Buffer.from(payload.data)));
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram error:", err);
    connection.destroy();
  });

  response.say("Hello, please speak now.");

  // TODO: Add the rest of the logic here, including hangup
}

new VoiceServer().listen(handler);
In the example above, we created a VoiceServer that listens for incoming calls. Upon receiving a call, the server answers and initializes a new stream configured to receive audio from the caller.
Next, a connection is established to a transcription service (Deepgram in this case). The transcription service processes the audio payloads and returns the transcribed text.
The Stream verb doesn’t yet support the “IN”, towards the caller, direction. However, you can use the Play and Say verbs to send audio to the caller.

SIP Network
Understanding SIP networking in Fonoster

Fonoster’s SIP Network provides a robust infrastructure for handling Voice over IP (VoIP) communications powered by Routr.io. This foundation enables integration between modern applications and traditional telephony systems through the Session Initiation Protocol (SIP).
​
Overview
The SIP Network in Fonoster is designed with a telephony-first approach, making it particularly powerful for:
Connecting legacy SIP-based systems with modern applications
Enabling voice communications across different networks
Managing complex routing scenarios between various endpoints
Providing secure and controlled access to telephony resources
​
SIP elements
The SIP Network consists of several key components that work together to enable voice communications:
​
Domains
A Domain represents a logical grouping of SIP resources. It defines the scope and boundaries for SIP communications and includes routing policies, access control rules, and context settings for SIP addressing.
​
Agents
Agents are SIP endpoints that can initiate and receive calls within a Domain. These could be SIP phones, Softphones, SIP-enabled applications, and Browser-based softphones like SIP.js.
​
Numbers
Numbers represent telephone numbers in the system and define how calls are routed to/from the PSTN network and mapping between telephone numbers and SIP addresses.
You can also define the geographic information associated with a number.
​
Trunks
Trunks provide connectivity to external networks, particularly PSTN (Public Switched Telephone Network) connectivity, connections to other SIP providers, and gateway services for external communications.
​
Access Control Lists (ACLs)
ACLs provide security by controlling which IP addresses can access the system, what operations are allowed, and access patterns and restrictions.
ACLs in Fonoster operate at the Domain level.
​
Routing types
Fonoster’s SIP Network supports various routing scenarios:
​
Agent-to-Agent
It enables direct communication between Agents within the same domain, which is ideal for internal communications.
​
Agent-to-PSTN
Allows agents to make calls to external telephone numbers through configured trunks.
​
PSTN-to-Agent
Enables incoming calls from external telephone numbers to reach specific agents.
​
Key benefits
Fonoster’s SIP Network architecture provides several advantages:
Legacy integration: Interconnection with traditional telephony systems with modern applications
Flexibility: Support for various routing scenarios and communication patterns
Security: Built-in access control and authentication mechanisms
Scalability: Distributed architecture supporting growth in usage and complexity
Standards compliance: Implementation based on established SIP protocols and standards
​
Use cases
The SIP Network is particularly valuable for:
Contact Centers integrating with existing telephony infrastructure
Voice applications requiring PSTN connectivity
Organizations modernizing legacy phone systems
Businesses requiring complex call routing scenarios
Applications needing secure voice communication capabilities
By leveraging Fonoster’s SIP Network, developers can build sophisticated voice applications while maintaining compatibility with traditional telephony systems and modern communication needs.

Calling
Outbound and inbound calls with Fonoster.

Fonoster provides capabilities for handling both inbound and outbound calls. Before making or receiving calls, you’ll need three key components:
A SIP Trunk to connect to the telephony network
A virtual phone number associated with your trunk
An application to handle the call logic
Please see the Linking a Twilio number guide for a quick start.
​
Prerequisites
First, create an application that will handle your calls. You can do this using the SDK:
create-app.js
const SDK = require("@fonoster/sdk");

const client = new SDK.Client({ accessKeyId: "WO000000000000000000000000000000" });

const appConfig = {
  name: "My Calling App",
  type: "EXTERNAL",
  endpoint: "welcome.demo.fonoster.local", // Demo application
  speechToText: {
    productRef: "stt.deepgram",
    config: {
      languageCode: "en-US"
    }
  },
  textToSpeech: {
    productRef: "tts.deepgram",
    config: {
      voice: "aura-asteria-en"
    }
  }
}

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => new SDK.Applications(client).createApplication(appConfig))
  .catch(console.error);
Or using the command-line tool:
fonoster applications:create
​
Inbound calls
You need a virtual phone number linked to your application to receive inbound calls. The easiest way to get started is with a Twillio number.
To link an application to a Twilio number, run the following command and follow the prompts:
fonoster sipnet:numbers:linkTwilioNumber
You are now ready to begin accepting inbound calls.
​
Outbound calls
You can make outbound calls using either the SDK or the command-line tool.
​
Using the SDK
call.js
const SDK = require("@fonoster/sdk");

const client = new SDK.Client({ accessKeyId: "WO000000000000000000000000000000" });

async function makeCall() {
  const calls = new SDK.Calls(client);
  const breakReasons = ["ANSWER", "NOANSWER", "BUSY", "FAILED", "CANCEL"];

  try {
    const { ref, statusStream } = await calls.createCall({
      from: "+18287854037",
      to: "+17853178070",
      // Replace with your application reference
      appRef: "4b01c9b1-8cb1-48fb-bd49-f3daf13463a9",
      timeout: 30,
      // This will be available in the initial request sent to your application.
      metadata: {
        name: "John Doe",
        preferredLanguage: "en-US"
      }
    });

    console.log(`Call created with reference: ${ref}`);

    // Monitor call status
    for await (const s of statusStream) {
      console.log(`Call status: ${s.status}`);
      if (breakReasons.includes(s.status)) {
        break;
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("Error making call:", err);
  }
}

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(() => makeCall())
  .catch(console.error);
​
Using the command-line tool
First, get your application reference:
fonoster applications:list
Then make the call:
fonoster sipnet:calls:create \
  --app-ref 4b01c9b1-8cb1-48fb-bd49-f3daf13463a9 \ # Replace with your application reference
  --from +18287854037 \
  --to +17853178070
  --metadata '{"name": "John Doe", "preferredLanguage": "en-US"}'
​
Call status monitoring
When using the SDK, you can monitor call status through the statusStream:
const { ref, statusStream } = await calls.createCall({
  from: "+18287854037",
  to: "+17853178070",
  appRef: "4b01c9b1-8cb1-48fb-bd49-f3daf13463a9"
});

// Monitor call status changes
for await (const status of statusStream) {
  switch(status) {
    case "RINGING":
      console.log("Call is ringing");
      break;
    case "IN_PROGRESS":
      console.log("Call is connected");
      break;
    case "COMPLETED":
      console.log("Call completed successfully");
      break;
    case "FAILED":
      console.log("Call failed");
      break;
  }
}
Learn More
For more advanced call control features, check out the Programmable Voice documentation.

Linking a Twilio number
Using the command-line tool to link a Twilio number.

While Fonoster supports multiple SIP providers, Twilio is one of the easiest to set up. This guide will show you how to link a Twilio phone number to your application using the command-line tool.
1
Request early access

To get started, you’ll need a Fonoster account. Sign up at https://app.fonoster.com/auth/signup
2
Sign up for a Twilio account

You need a Twilio account to link a Twilio phone number to your Fonoster application. You can sign up for a Twilio account by visiting the Twilio website and following their documentation.
3
Link your virtual phone number

Follow the next steps to link a virtual phone number to your application:
Install the command-line tool

Fonoster CTL is a command-line tool that allows you to manage your Fonoster resources. You can create, update, and delete Fonoster resources like phone numbers, SIP trunks, etc.
You can install the tool using the following command:
npm install -g @fonoster/ctl
Check that the installation was successful by running the following command:
fonoster --version
If the installation was successful, you should see the version number of the command-line tool.
Log in to a Fonoster Workspace

Before using the command-line tool, log in to a Workspace. You can do this by running the following command:
fonoster workspaces:login
This command will prompt you to enter your AccessKeyId and AccessKeySecret. Once you have entered this information, you will be logged in to your Workspace.
Create a new Application

To create a new Application, you can use the following command:
fonoster applications:create
You will be asked to enter the Application’s name, speech information, and other details. Once you have entered this information, the Application will be created.
Your output should look like this:

Yo can list your existing applications with the following command:
fonoster applications:list
Link a Twilio phone number

To link a Twilio phone number to your application, you can use the following command:
fonoster sipnet:numbers:linkTwilioNumber
You will be asked to enter an existing virtual phone number, the Twilio SID, and the Twilio Auth Token. Once you have entered this information, the Twilio phone number will be linked to your application.
To confirm that the phone number was linked successfully, you can run the following command:
fonoster sipnet:numbers:list
You can now call the Twilio phone number to access your voice application.
Twilio is used as an example. You can use other SIP providers as well.
Make an outbound call

You can use the command-line tool or the SDK to make an outbound call. To make an outbound call, first, you need the reference of the application you created. You can get the reference by running the following command:
fonoster applications:list
Once you have the reference, you can use the fonoster sipnet:calls:create command to make an outbound call. Here is an example:
fonoster sipnet:calls:create --app-ref 4b01c9b1-8cb1-48fb-bd49-f3daf13463a9 \
 --from +18456134823 \
 --to +17853134923
You can also use the SDK to make an outbound call. To do this, you can use the following code:
call.js
const SDK = require("@fonoster/sdk");

# Replace with your Workspace Access Key Id
const client = SDK.Client({ accessKeyId: "00000000-0000-0000-0000-000000000000" });

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => {
    const calls = new SDK.Calls(client);

    const response = await calls.createCall({
      from: "+18456134823",
      to: "+17853134923",
      appRef: "4b01c9b1-8cb1-48fb-bd49-f3daf13463a9"
    })

    console.log(response);
  });
Replace the example values with the appropriate ones.
Now that you have linked a Twilio phone number to your application, you can start making and receiving calls using the command-line tool or the SDK.

Linking any virtual number
Connecting any SIP provider with Fonoster.

This guide will walk you through connecting your SIP provider to Fonoster by setting up authentication, configuring a SIP trunk, and creating your virtual number. Follow the steps below to link any virtual number to your application.
For Twilio numbers, consider using the dedicated command fonoster sipnet:numbers:linkTwilioNumber for a simplified process.
1
Request early access

To get started, you’ll need a Fonoster account. Sign up at https://app.fonoster.com/auth/signup
2
Set Up Authentication (If required)

If your VoIP provider requires SIP authentication, run the following command and follow the interactive prompts:
fonoster sipnet:credentials:create
Before running this command, please request the necessary credentials from your provider.
If your provider uses static IP authentication, provide them with the following IP address:
165.22.7.155
Your provider will use it to verify the origin of the signaling.
3
Configure Your SIP Trunk

Before creating your trunk, verify with your provider the preferred transport protocol (e.g., TCP or UDP). Use the same protocol when specifying your Outbound URI. Use the following command to create your trunk:
fonoster sipnet:trunks:create
Follow the prompts to complete the configuration. Ensure your Inbound URI ends with .sip.fonoster.com. For example, if your company is Acme Corp, you might use acme.sip.fonoster.com
Inbound URIs are globally unique. If you receive an error, please try using a different value.
4
Create and Verify Your Virtual Number

With your trunk in place, create a virtual number to route incoming SIP traffic. Execute the command below:
fonoster sipnet:numbers:create
You will be prompted for the details of your virtual number. Ensure that this number exactly matches the value your provider sends in the FROM header of the SIP traffic. Any discrepancy may prevent proper traffic matching.
If you encounter an error such as “Number already exists,” please contact the Fonoster support team. They will help resolve any conflicts with existing numbers.
Finally, to check that your virtual Number has been linked successfully by listing your Numbers with:
fonoster sipnet:numbers:list
Once the Number is linked, try calling it to ensure the voice application is accessible.

Overwriting speech voices
Overwriting speech voices with the Say verb.

When creating a voice application, you will define the voice used to speak the text. To illustrate this, let’s define a simple voice application using Deepgram for speech-to-text using the SDK:
create-app.js
const SDK = require("@fonoster/sdk");

const client = new SDK.Client({ accessKeyId: "WO000000000000000000000000000000" });

const appConfig = {
  name: "Custom Voice App",
  type: "EXTERNAL",
  endpoint: "0.tcp.ngrok.io:17263",
  speechToText: {
    productRef: "stt.deepgram",
    config: {
      languageCode: "en-US"
    }
  },
  textToSpeech: {
    productRef: "tts.deepgram",
    config: {
      voice: "aura-asteria-en"
    }
  }
}

client.loginWithApiKey("AP0eerv2g7qow3e950k7twu4rvydcunq3k", "fNc...")
  .then(async() => new SDK.Applications(client).createApplication(appConfig))
  .catch(console.error);
And now, let’s create a simple voice application using the Say verb:
voice-server.js
const VoiceServer = require("@fonoster/voice").default;

new VoiceServer().listen(async (req, response) => {
  // Verbs go here
  await response.answer();
  await response.say("Hello World!");
  await response.hangup();
});
The application in the example above uses the speech settings described in the application configuration. The Say verb will use the voice defined in the textToSpeech object. In this case, the voice used is “aura-asteria-en”.
If you want to overwrite the voice the Say verb uses, you can pass the voice attribute to the say method. Here is an example:
voice-server.js
const VoiceServer = require("@fonoster/voice").default;

new VoiceServer().listen(async (req, response) => {
  // Verbs go here
  await response.answer();
  await response.say("Hello World by Aura Asteria!");
  await response.say("Hello World by Aura Luna!", { voice: "aura-luna-en" });
  await response.hangup();
});
In the example above, the first say method will use the “aura-asteria-en” voice, and the second say method will use the “aura-luna-en” voice. The voice attribute is optional. If you don’t pass it, the Say verb will use the voice defined in the application configuration.

Overview
Self-hosting Fonoster.

Self-hosting Fonoster involves running Fonoster’s server on your data center. Self-hosting is helpful if you want to run Fonoster on a private network or if you want to customize Fonoster’s behavior. While this offers more flexibility, it also requires more technical knowledge, and some features may not be available.

Deploy with Docker
Self-hosting with Docker and Docker Compose.

Docker is the easiest way to deploy a self-hosted instance of Fonoster. This guide will walk you through deploying the Fonoster services using Docker and Docker Compose.
​
Prerequisites
The only prerequisite for Fonoster is to have Docker installed on the host machine.
​
Step-by-step installation
1
Prepare the environment

Follow the next few steps to prepare the environment:
Create a new directory

Create a new directory in your preferred location and change it. The root directory we will use in the guide is fonoster.
mkdir -p fonoster/config
cd fonoster
Download the example configuration

Copy the .env.example from the repository to the current directory and rename it to .env. This file contains all the environment variables that the services need to run.
You can use the following commands to copy all the necessary files:
curl -o .env https://raw.githubusercontent.com/fonoster/fonoster/master/.env.example
curl -o ./compose.yaml https://raw.githubusercontent.com/fonoster/fonoster/master/compose.yaml
curl -o ./config/integrations.json https://raw.githubusercontent.com/fonoster/fonoster/master/config/integrations.example.json
curl -o ./config/envoy.yaml https://raw.githubusercontent.com/fonoster/fonoster/master/config/envoy.yaml
Update the configuration

Then, open the .env file with your favorite editor and update the following variables:
ASTERISK_SIPPROXY_HOST: Set this variable to the IP address of the host machine.
ROUTR_EXTERNAL_ADDRS: Set this variable to the IP address of the host machine.
ROUTR_RTPENGINE_HOST: Set this variable to the IP address of the host machine.
The integrations.json file contains the credentials for the integrations (stt, tts, etc). You must update this file with the correct credentials for the integrations you want to use.
In addition to the previous variables, you should update all the secrets and ensure the .env file is safely stored.
2
Generate keys

Next, generate a set of public and private keys for the server. You can use the following command to generate the keys:
mkdir -p config/keys
openssl genpkey -algorithm rsa -out config/keys/private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in config/keys/private.pem -out config/keys/public.pem
chmod 644 config/keys/*
3
Confirm the directory structure

Your directory structure should look like this:
.
├── .env
├── compose.yaml
└── config
    ├── envoy.yaml
    ├── integrations.json
    └── keys
        ├── private.pem
        └── public.pem

3 directories, 6 files
If it looks different, go back and review your steps.
4
Start the server

Finally, run the following command to start the application:
docker compose up -d
After a few moments, you can interact with Fonoster using the API or SDK.

First API Keys
Initial setup of API keys for a self-hosted instance.

Fonoster uses a Workspace-centric approach, meaning all operations are performed against a specific Workspace. By default, when you self-host Fonoster, it automatically creates a default Workspace along with a default username and password.
Default accessKeyId: WO00000000000000000000000000000000
Default username: admin@fonoster.local
Default password: changeme
You must create API keys to log in to a Workspace and perform operations.
​
Create an API Key
1
Prepare the environment

First, create a new folder (e.g., fonoster-apikeys-demo) and navigate to it.
mkdir fonoster-apikeys-demo
cd fonoster-apikeys-demo
npm init -y
2
Install the SDK

Install the @fonoster/sdk package.
npm install @fonoster/sdk
3
Create the script

Once the installation is complete, create a new file called index.js and add the following code:
const SDK = require("@fonoster/sdk");

// Replace these with your values
const client = new SDK.Client({
  accessKeyId: "WO00000000000000000000000000000000",
  endpoint: "localhost:8449",
  allowInsecure: true
});

// Use your actual username and password here
client.login("admin@fonoster.local", "changeme").then(async () => {
  const apikeys = new SDK.ApiKeys(client);

  apikeys.createApiKey({
    role: "WORKSPACE_ADMIN",
  }).then((result) => {
    console.log(result);
  });
});
4
Run the script

Finally, run the script.
node index.js
If everything goes well, you should see the new API key printed to the console, and you can use it to log in to your Workspace.

Securing the API
Securing the API with TLS.

Securing Fonoster’s API with Let’s Encrypt certificates is essential to ensure encrypted communication. This process involves setting up a temporary Nginx server, obtaining the certificate, and configuring auto-renewal.
Here are the steps to accomplish this task:
1
Prepare the environment

First, create the necessary directories:
mkdir -p letsencrypt/nginx-conf
mkdir -p letsencrypt/certbot/www
mkdir -p letsencrypt/certbot/conf
2
Configure Nginx

Next, create Nginx’s configuration file with the following content:
letsencrypt/nginx-conf/nginx.conf
events {
  worker_connections 1024;
}

http {
  server {
    listen 80;
    listen [::]:80;
    server_name app.example.com api.example.com sip.example.com;

    location /.well-known/acme-challenge/ {
      root /var/www/html;
    }

    location / {
      return 404;
    }
  }
}
Replace api.example.com and app.example.com with your domain name, and remember to point the domain to the server’s IP address.
3
Start the container

Then, start the Nginx container to handle the ACME challenge:
docker run -d --name nginx \
  -p 80:80 \
  -v $(pwd)/letsencrypt/nginx-conf/nginx.conf:/etc/nginx/nginx.conf:ro \
  -v $(pwd)/letsencrypt/certbot/www:/var/www/html \
  nginx:latest
4
Retrieve the certificates

Now, run Certbot to obtain the Let’s Encrypt certificate:
docker run -it --rm \
  -v $(pwd)/letsencrypt/certbot/conf:/etc/letsencrypt \
  -v $(pwd)/letsencrypt/certbot/www:/var/www/html \
  certbot/certbot certonly --webroot \
  --webroot-path /var/www/html \
  --email your@email.com --agree-tos --no-eff-email \
  -d app.example.com -d api.example.com -d sip.example.com
Replace the email and domain name with your information.
You should see a message indicating that the certificate was successfully obtained.
5
Remove the container

After obtaining the certificate, stop and remove the temporary Nginx container:
docker stop nginx
docker rm nginx
6
Set the auto-renewal

Next, set up auto-renewal by creating a script named renew_cert.sh:
renew_cert.sh
#!/bin/bash

docker run --rm \
 -v /path/to/letsencrypt/certbot/conf:/etc/letsencrypt \
  -v /path/to/letsencrypt/certbot/www:/var/www/html \
 certbot/certbot renew
Please replace /path/to with the actual path to the directories.
Make the script executable and add a cron job to run it twice daily:
chmod +x renew_cert.sh
(crontab -l 2>/dev/null; echo "0 0,12 * * * /path/to/renew_cert.sh") | crontab -
Replace /path/to with the actual path to the script.
7
Finalize settings and run the process

Finally, find the Envoy container in your compose file, mount the Let’s Encrypt certificates, and open port 443.
By following these steps, you’ll have successfully secured Fonoster’s API with Let’s Encrypt certificates and set up auto-renewal to maintain the security of your communications.

Hacking the Backend
A quick guide to contributing to Fonoster’s backend

This guide contains the development environment setup for Fonoster. It includes the API Server and supporting infrastructure.
​
Prerequisites
Docker and Docker Compose
NodeJS >= v20
Git (Optional)
​
Hacking the Backend
To start hacking the backend, start by cloning the project, and copying the .env.example.dev and ./config/integrations.example.json
Here is an example:
git clone https://github.com/fonoster/fonoster
cd fonoster
cp .env.example.dev .env
cp config/integrations.example.json config/integrations.json
In the .env file you will need to find and update the following variables. All variables will need to be updated to a routable IP within your local environment.
Variable	Description
ROUTR_EXTERNAL_ADDRS	The IP used by Routr to advertise it’s address to othe SIP endpoints
ROUTR_RTPENGINE_HOST	The address of RTPEngine
ASTERISK_SIPPROXY_HOST	Address pointing to Routr SIP Server
APISERVER_ROUTR_API_ENDPOINT	The entrypoint to Routr’s API
DOCKER_HOST_ADDRESS	The address of the host machine
With ifconfig | grep "en0" -A 5 on Linux or Mac you will see a good candidate to use as the IP.
Next, you need to install and build the project.
npm install
npm run build
npm run test
Then, you need to start the infrastructure and initialize the database using the following commands:
npm run start:services
npm run db:migrate
npm run db:seed
The previous command will start all the services including envoy, mailhog, adminer, influxdb, postgres, and asterisk.
Finally, start the API Server with:
npm run start:apiserver
​
Running the Integration Tests
A good indicator that your environment is correctly setup is having ALL passing in your integration tests. Run the integration test, on a separate terminal, with the following command:
npm run integration