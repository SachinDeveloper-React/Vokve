# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# WorkManager builds each job's InputMerger by reflection, from its class
# name, with the no-argument constructor. The rule WorkManager 2.9.1 ships
# keeps the class and says nothing of the constructor, which R8 then
# removes: every job fails before its worker is created ("Could not create
# Input Merger androidx.work.OverwritingInputMerger"), and nothing shows it
# but a line in logcat. That is the daily and the nightly step sync
# (StepSyncWorker) and the step tracker's own jobs, in release builds only.
-keep class * extends androidx.work.InputMerger { <init>(); }

# Not kept, deliberately: com.android.installreferrer.api.**.
# react-native-device-info reaches Play's install-referrer client by
# reflection as it starts, and in a release build that lookup now fails -
# one caught NoSuchMethodException in logcat per launch
# (RNInstallReferrerClient), and `getInstallReferrer()` answering "unknown".
# The app never asks for the referrer, so the rule that would keep it would
# only keep the app connecting to the Play Store on every launch for a value
# nobody reads. If referral attribution ever wants it, the rule is:
#   -keep class com.android.installreferrer.api.** { *; }
