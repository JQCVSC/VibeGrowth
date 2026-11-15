import React, { createContext, useContext, useState } from 'react';

interface AuditContextType {
  isAuditModalOpen: boolean;
  openAuditModal: () => void;
  closeAuditModal: () => void;
}

const AuditContext = createContext<AuditContextType | undefined>(undefined);

export const AuditProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const openAuditModal = () => setIsAuditModalOpen(true);
  const closeAuditModal = () => setIsAuditModalOpen(false);

  return (
    <AuditContext.Provider value={{ isAuditModalOpen, openAuditModal, closeAuditModal }}>
      {children}
    </AuditContext.Provider>
  );
};

export const useAudit = () => {
  const context = useContext(AuditContext);
  if (context === undefined) {
    throw new Error('useAudit must be used within an AuditProvider');
  }
  return context;
};
