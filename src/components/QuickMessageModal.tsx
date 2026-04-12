import { useState, useEffect } from 'react';
import { X, Send, Check, User, Phone, MessageSquare } from 'lucide-react';
import { sendMessageToAlex } from '@/api/squareMessages';

interface QuickMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickMessageModal({ isOpen, onClose }: QuickMessageModalProps) {
  const [step, setStep] = useState<'form' | 'sending' | 'sent' | 'error'>('form');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
      setStep('form');
      setName('');
      setPhone('');
      setMessage('');
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('sending');

    const result = await sendMessageToAlex({
      senderName: name,
      senderPhone: phone,
      message,
    });

    if (result.success) {
      setStep('sent');
      setTimeout(() => onClose(), 2500);
    } else {
      setErrorMessage(result.error || 'Message could not be sent. Please try again.');
      setStep('error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#0B0B0D] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FF4D2E]/20 flex items-center justify-center">
              <MessageSquare size={18} className="text-[#FF4D2E]" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-white">
                {step === 'sent' ? 'Message Sent!' : 'Message Alex'}
              </h2>
              {step === 'form' && <p className="text-white/50 text-xs">Usually replies within a few hours</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {step === 'sent' ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-[#FF4D2E]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="text-[#FF4D2E]" size={32} />
              </div>
              <p className="text-white font-semibold mb-1">Got it!</p>
              <p className="text-white/60 text-sm">Alex will get back to you shortly.</p>
            </div>
          ) : step === 'error' ? (
            <div className="text-center py-6">
              <p className="text-white font-semibold mb-2">Couldn't deliver</p>
              <p className="text-white/60 text-sm mb-4">{errorMessage}</p>
              <button
                onClick={() => { setStep('form'); setErrorMessage(''); }}
                className="text-[#FF4D2E] text-sm font-semibold hover:underline"
              >
                Try again
              </button>
            </div>
          ) : step === 'sending' ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-white/20 border-t-[#FF4D2E] rounded-full animate-spin" />
            </div>
          ) : (
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    placeholder="Your name"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    required
                    placeholder="Your phone number"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors"
                  />
                </div>
              </div>

              <div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  required
                  rows={3}
                  placeholder="Hi Alex, I'm interested in..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white text-sm placeholder-white/30 focus:outline-none focus:border-[#FF4D2E] transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={!name || !phone || !message}
                className="w-full btn-primary disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                <Send size={16} />
                Send Message
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
