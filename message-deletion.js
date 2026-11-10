// Keep the message available for retry until its attachment is confirmed absent.
export async function deleteMessageWithPdf(message, operations) {
  let stage = 'pdf';
  let pdfDeleted = false;
  try {
    if (message.pdfUrl) {
      await operations.requirePdfAuth();
      try {
        await operations.deletePdf(message.pdfUrl);
      } catch (error) {
        // A previous attempt may already have removed the attachment.
        if (error?.code !== 'storage/object-not-found') throw error;
      }
      stage = 'verification';
      try {
        await operations.getPdfMetadata(message.pdfUrl);
      } catch (error) {
        if (error?.code !== 'storage/object-not-found') throw error;
        pdfDeleted = true;
      }
      if (!pdfDeleted) {
        const error = new Error('添付PDFが保存先に残っています。');
        error.code = 'storage/delete-unconfirmed';
        throw error;
      }
    }
    stage = 'message';
    await operations.deleteMessage(message.id);
    return { pdfDeleted };
  } catch (cause) {
    const error = new Error(cause?.message || '削除を完了できませんでした。');
    error.code = cause?.code || 'unknown';
    error.stage = stage;
    error.pdfDeleted = pdfDeleted;
    throw error;
  }
}
