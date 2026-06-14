import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

const lastUpdated = 'June 14, 2026'

const pages = {
  terms: {
    title: 'Terms & Conditions',
    eyebrow: 'CalCheck AI Calorie Tracker',
    intro:
      'These Terms explain how you may use CalCheck AI Calorie Tracker, a web app and Progressive Web App provided by Mave Technologies (Proprietorship). By using CalCheck AI, you agree to these Terms.',
    sections: [
      {
        title: '1. About CalCheck AI',
        body: [
          'CalCheck AI helps you estimate calories and nutrition from food photos, save meal history, track progress, sign in with Google, and use a recurring CalCheck Pro subscription for unlimited scans.',
          'CalCheck AI is for general wellness and personal tracking only. It is not a medical device and does not provide medical, nutrition, diet, diagnosis, or treatment advice.'
        ]
      },
      {
        title: '2. Accounts and Google Login',
        body: [
          'You may need to sign in with Google to save meals, track progress, and manage subscriptions. You are responsible for keeping access to your Google account secure.',
          'You agree to provide accurate account information and to use CalCheck AI only for lawful, personal purposes.'
        ]
      },
      {
        title: '3. AI Food Recognition and Nutrition Estimates',
        body: [
          'Food images are processed using AI models to identify likely foods and estimate nutrition. Results can be wrong, incomplete, or affected by image quality, portion size, ingredients, preparation method, packaging, or regional recipes.',
          'Do not rely on CalCheck AI for medical or dietary decisions. If you have a health condition, allergy, eating disorder, prescribed diet, or fitness target that affects your health, consult a qualified healthcare professional.'
        ]
      },
      {
        title: '4. Free Plan and CalCheck Pro',
        body: [
          'The Free Plan includes 2 lifetime scans. CalCheck Pro includes unlimited scans while your subscription is active.',
          'CalCheck Pro is a monthly recurring subscription. India pricing is INR 69/month. International pricing is USD 1.99/month. Taxes, bank charges, exchange rates, or processor fees may apply depending on your location and payment method.'
        ]
      },
      {
        title: '5. Billing and Cancellation',
        body: [
          'Subscriptions are billed through Razorpay. By starting CalCheck Pro, you authorize recurring monthly billing until you cancel.',
          'You may cancel anytime. Cancellation stops future renewals, and your Pro access continues until the end of the current billing period.',
          'We do not provide partial or prorated refunds for unused subscription periods unless required by law.'
        ]
      },
      {
        title: '6. Acceptable Use',
        body: [
          'You agree not to misuse CalCheck AI, interfere with the app, bypass scan limits, reverse engineer the service, upload illegal or harmful content, attempt unauthorized access, or use automated systems to overload the app.',
          'You must not use CalCheck AI to make emergency, clinical, or high-risk medical decisions.'
        ]
      },
      {
        title: '7. Intellectual Property',
        body: [
          'CalCheck AI, including the app design, brand, software, text, and related materials, is owned by Mave Technologies (Proprietorship) or its licensors.',
          'You keep ownership of content you upload, but you give us permission to process it as needed to provide the app features.'
        ]
      },
      {
        title: '8. Account Termination',
        body: [
          'We may suspend or terminate access if you violate these Terms, misuse the service, create risk for other users, or if we are required to do so by law.',
          'You may stop using CalCheck AI at any time. Subscription cancellation is handled separately from signing out or uninstalling the PWA.'
        ]
      },
      {
        title: '9. Limitation of Liability',
        body: [
          'CalCheck AI is provided on an as-is and as-available basis. To the maximum extent allowed by law, Mave Technologies (Proprietorship) is not liable for indirect, incidental, special, consequential, or punitive damages, or for decisions made using estimated nutrition results.',
          'Nothing in these Terms limits rights that cannot be limited under applicable law.'
        ]
      }
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    eyebrow: 'How CalCheck AI handles data',
    intro:
      'This Privacy Policy explains what data CalCheck AI Calorie Tracker collects, why we collect it, and how it is used to provide the app.',
    sections: [
      {
        title: '1. Data We Collect',
        body: [
          'Account data: your Google account identifier, email address, and basic profile details needed for authentication and account creation.',
          'Food and nutrition data: food photos submitted for analysis, AI nutrition estimates, selected meal results, meal history, timestamps, local dates, meal types, and progress totals.',
          'Subscription data: plan status, Razorpay subscription identifiers, billing currency, billing period, renewal or cancellation status, and payment confirmation events. We do not store your full card, UPI, or banking details.',
          'Usage and analytics data: app interactions, scan usage, device or browser information, PWA install behavior, diagnostics, and error logs used to improve reliability and prevent abuse.'
        ]
      },
      {
        title: '2. How We Use Data',
        body: [
          'We use your data to sign you in, analyze food images, estimate nutrition, save meal history, show progress, manage scan limits, process CalCheck Pro subscriptions, provide support, protect the app, and improve performance.',
          'Food photos are processed using AI models to generate estimates. Meal history is saved to your account so you can review progress across sessions.'
        ]
      },
      {
        title: '3. Google Authentication',
        body: [
          'Google Login is used for authentication and account creation. Google may process your login according to its own privacy policy.',
          'CalCheck AI uses Google account information only to identify your account, secure access, and personalize saved app data.'
        ]
      },
      {
        title: '4. Payments Through Razorpay',
        body: [
          'Payments and recurring subscriptions are processed by Razorpay. Razorpay handles payment method details and may collect information needed to process payments, comply with law, prevent fraud, and manage billing.',
          'We receive subscription status and payment confirmation data from Razorpay so we can activate, renew, cancel, or expire CalCheck Pro access.'
        ]
      },
      {
        title: '5. Data Retention',
        body: [
          'We keep account, meal, progress, and subscription records for as long as needed to provide CalCheck AI, comply with legal obligations, resolve disputes, prevent abuse, and maintain accurate billing records.',
          'If you request deletion, we will delete or anonymize eligible personal data unless we need to retain it for legal, security, fraud-prevention, or accounting reasons.'
        ]
      },
      {
        title: '6. Sharing and Service Providers',
        body: [
          'We share data with service providers only as needed to run CalCheck AI, including Supabase for backend services, Google for login, Razorpay for payments, AI providers for image analysis, hosting providers, analytics, and diagnostic tools.',
          'We do not sell your personal information.'
        ]
      },
      {
        title: '7. Your Rights',
        body: [
          'Depending on your location, you may have rights to access, correct, delete, export, restrict, or object to certain processing of your personal data.',
          'You can sign out anytime, cancel subscriptions anytime, and contact us to request help with your account data.'
        ]
      },
      {
        title: '8. Security',
        body: [
          'We use reasonable technical and organizational measures to protect your data. No internet service is completely secure, so please use a secure Google account and device.'
        ]
      }
    ]
  },
  faq: {
    title: 'FAQs',
    eyebrow: 'Quick answers',
    intro: 'Plain-English answers about CalCheck AI Calorie Tracker, scans, subscriptions, refunds, and installation.',
    sections: [
      {
        title: 'What is CalCheck?',
        body: [
          'CalCheck AI Calorie Tracker is a web app and PWA that uses food photos to estimate calories, protein, carbs, fat, and other nutrition details. You can save meals, view meal history, and track progress over time.'
        ]
      },
      {
        title: 'How does AI food recognition work?',
        body: [
          'You take or upload a food photo. CalCheck AI sends the image for AI analysis, receives likely food and nutrition estimates, and shows the result so you can review and save it.'
        ]
      },
      {
        title: 'Is CalCheck accurate?',
        body: [
          'CalCheck AI provides estimates, not guaranteed measurements. Accuracy can vary based on photo quality, portion size, hidden ingredients, cooking method, and recipe differences.'
        ]
      },
      {
        title: 'How many free scans do I get?',
        body: ['The Free Plan includes 2 lifetime scans.']
      },
      {
        title: 'What is CalCheck Pro?',
        body: [
          'CalCheck Pro is the paid plan for unlimited AI calorie scans while your subscription is active.'
        ]
      },
      {
        title: 'How do subscriptions work?',
        body: [
          'CalCheck Pro is a monthly recurring subscription billed through Razorpay. India pricing is INR 69/month. International pricing is USD 1.99/month.'
        ]
      },
      {
        title: 'Can I cancel anytime?',
        body: [
          'Yes. You can cancel anytime. Cancellation stops future renewals, and Pro access continues until the end of your current billing period.'
        ]
      },
      {
        title: 'Do you offer refunds?',
        body: [
          'Monthly subscriptions are not prorated after cancellation. We do not offer partial refunds for unused time unless required by law.'
        ]
      },
      {
        title: 'Is CalCheck a medical app?',
        body: [
          'No. CalCheck AI is not a medical device and does not provide medical advice. Consult a healthcare professional for medical, dietary, allergy, or health decisions.'
        ]
      },
      {
        title: 'Can I install CalCheck on my phone?',
        body: [
          'Yes. CalCheck AI is a Progressive Web App, so supported browsers can install it on your phone for faster access and a full-screen app experience.'
        ]
      }
    ]
  },
  about: {
    title: 'About Us',
    eyebrow: 'Mave Technologies (Proprietorship)',
    intro:
      'CalCheck AI Calorie Tracker is built to make everyday food tracking faster, simpler, and easier to keep up with.',
    sections: [
      {
        title: 'Our Product',
        body: [
          'CalCheck AI combines AI food recognition, nutrition estimation, meal history, progress tracking, Google authentication, subscription billing, and PWA installation in one mobile-friendly web app.',
          'The goal is simple: take a food photo, review the estimate, save the meal, and keep moving.'
        ]
      },
      {
        title: 'Who Operates CalCheck AI',
        body: [
          'CalCheck AI Calorie Tracker is operated by Mave Technologies (Proprietorship).'
        ]
      },
      {
        title: 'Important Health Notice',
        body: [
          'CalCheck AI is a wellness and tracking tool, not a medical device. Nutrition results are AI-generated estimates and may not be perfectly accurate.',
          'For medical conditions, prescribed diets, allergies, eating disorders, or health-critical nutrition choices, please consult a qualified healthcare professional.'
        ]
      },
      {
        title: 'Plans and Access',
        body: [
          'The Free Plan includes 2 lifetime scans. CalCheck Pro provides unlimited scans through a monthly recurring subscription: INR 69/month in India and USD 1.99/month internationally.'
        ]
      }
    ]
  }
}

export default function InfoPage() {
  const navigate = useNavigate()
  const { slug } = useParams()
  const page = pages[slug] || pages.terms

  return (
    <div className="min-h-full w-full bg-white overflow-y-auto pb-10">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 px-5 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700"
        >
          <ArrowLeft size={18} />
          <span>Back</span>
        </button>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-7">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-700">{page.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-gray-900">{page.title}</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {lastUpdated}</p>
        <p className="mt-5 text-base leading-7 text-gray-700">{page.intro}</p>

        <div className="mt-8 space-y-5">
          {page.sections.map((section) => (
            <section key={section.title} className="border-t border-gray-100 pt-5">
              <h2 className="text-lg font-bold leading-7 text-gray-900">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-6 text-gray-600">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
