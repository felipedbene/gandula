# Keep the JNI bridge: the native .so resolves these methods by name at load
# time, so R8/ProGuard must not rename or strip them.
-keep class dev.debene.gandula.NativeEngine { *; }
