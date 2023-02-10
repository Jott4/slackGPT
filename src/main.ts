import Bolt, { FileInstallationStore } from '@slack/bolt';
import 'dotenv/config';
import { Configuration, OpenAIApi } from 'openai';

const app = new Bolt.App({
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  port: 3000,
  installationStore: new FileInstallationStore(),
  scopes: [
    'app_mentions:read',
    'channels:history',
    'chat:write',
    'commands',
    'groups:history',
    'im:history',
    'mpim:history',
    'users:read',
  ],
  stateSecret: '',
  installerOptions: {
    stateVerification: false,
  },
});

const openAiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(openAiConfig);

const listeningThreads = {};

app.event('message', async ({ event, client, message }) => {
  if (!('text' in message) || !('thread_ts' in event)) {
    return;
  }

  const threadTs = event.thread_ts;

  if (threadTs && listeningThreads[threadTs]) {
    const answerMessage = await client.chat.postMessage({
      channel: event.channel,
      text: 'Aguarde um pouco, estou pensando...',
      thread_ts: threadTs,
    });

    const response = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: message.text,
      temperature: 0.4,
      max_tokens: 300,
      top_p: 1,
      n: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const text = response.data.choices[0].text;

    await client.chat.update({
      channel: event.channel,
      ts: answerMessage.ts,
      text,
    });
  }
});

app.event('app_mention', async ({ event, client }) => {
  listeningThreads[event.ts] = true;

  const answerMessage = await client.chat.postMessage({
    channel: event.channel,
    text: 'Aguarde um pouco, estou pensando...',
    thread_ts: event.ts,
  });

  const response = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: event.text,
    temperature: 0.4,
    max_tokens: 300,
    top_p: 1,
    n: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const text = response.data.choices[0].text;

  if (!text) {
    await client.chat.update({
      channel: event.channel,
      ts: answerMessage.ts,
      text: 'Não entendi o que você quis dizer :(',
    });
    return;
  }

  await client.chat.update({
    channel: event.channel,
    ts: answerMessage.ts,
    text,
  });
});

app.shortcut('summarize_thread', async ({ shortcut, ack, client }) => {
  await ack();
  if (!(shortcut.type === 'message_action')) {
    return;
  }

  const answerMessage = await client.chat.postMessage({
    channel: shortcut.channel.id,
    text: 'Aguarde um pouco, estou resumindo essa thread...',
    thread_ts: shortcut.message.ts,
  });

  const thread = await client.conversations.replies({
    channel: shortcut.channel.id,
    ts: shortcut.message.ts,
  });

  let finalMessage = 'Resuma essa thread do slack: \n';

  const messages = thread.messages.map(async (message) => {
    const username = await client.users.info({ user: message.user });

    finalMessage += `${username.user.profile.display_name_normalized}: ${message.text} \n`;
  });

  await Promise.all(messages);

  const response = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: finalMessage,
    temperature: 0.4,
    max_tokens: 300,
    top_p: 1,
    n: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const text = response.data.choices[0].text;

  if (!text) {
    await client.chat.update({
      channel: shortcut.channel.id,
      ts: answerMessage.ts,
      text: 'Não consegui resumir essa thread :(',
    });
    return;
  }

  await client.chat.update({
    channel: shortcut.channel.id,
    ts: answerMessage.ts,
    text: '*[RESUMO DA THREAD]* \n\n' + text,
  });
});

await app.start(process.env.PORT || 3000);
