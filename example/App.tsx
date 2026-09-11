/**
 * Expo example — a chat screen with a typing effect and a working stop button.
 *
 * Point OPENAI_PROXY at your own backend. Never ship an API key in an app;
 * the hook does not care what it is talking to, as long as the endpoint
 * streams text/event-stream.
 *
 * See example/README.md for setup.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useChatStream } from 'react-native-ai-stream/react';

const OPENAI_PROXY = 'https://your-backend.example.com/api/chat';

export default function App() {
  const [input, setInput] = useState('');

  const { messages, send, stop, isStreaming, error, reset } = useChatStream({
    url: OPENAI_PROXY,
    model: 'gpt-4o-mini',
    // adapter: 'anthropic',   // for the Anthropic messages API
  });

  const submit = () => {
    if (!input.trim()) return;
    send(input);
    setInput('');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Stream</Text>
        <TouchableOpacity onPress={reset}>
          <Text style={styles.reset}>Clear</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.user : styles.assistant,
            ]}
          >
            <Text style={item.role === 'user' ? styles.userText : styles.botText}>
              {item.content}
              {/* A caret while tokens are still arriving. */}
              {item.streaming ? ' ▋' : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Ask something to see it stream in.</Text>
        }
      />

      {error ? <Text style={styles.error}>{String(error)}</Text> : null}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.composer}
      >
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask anything…"
          editable={!isStreaming}
          onSubmitEditing={submit}
          returnKeyType="send"
        />

        {isStreaming ? (
          <TouchableOpacity style={[styles.button, styles.stopButton]} onPress={stop}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.buttonText}>Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.button} onPress={submit}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  title: { fontSize: 20, fontWeight: '700' },
  reset: { color: '#1f3864', fontWeight: '600' },
  list: { padding: 16, gap: 10 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: '85%' },
  user: { backgroundColor: '#1f3864', alignSelf: 'flex-end' },
  assistant: { backgroundColor: '#f1f2f6', alignSelf: 'flex-start' },
  userText: { color: '#fff', fontSize: 15 },
  botText: { color: '#111', fontSize: 15 },
  empty: { textAlign: 'center', color: '#999', marginTop: 48 },
  error: { color: '#c00', paddingHorizontal: 20, paddingBottom: 8, fontSize: 13 },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#1f3864',
    borderRadius: 22,
    paddingHorizontal: 20,
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stopButton: { backgroundColor: '#c0392b' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
